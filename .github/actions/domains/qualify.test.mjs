import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { classifyRegistryRead, overrideForDependencies, qualifyDomains } from './qualify.mjs'

async function domain(root, dir, name, dependencies = {}, additional = {}) {
  const project = join(root, dir)
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'astrale.config.ts'), 'export default {}\n')
  await writeFile(
    join(project, 'prepare.mjs'),
    `import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('lib', { recursive: true })
await writeFile('lib/index.js', 'export const value = 1\\n')
`,
  )
  await writeFile(
    join(project, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: '1.0.0',
        type: 'module',
        files: ['lib'],
        exports: './lib/index.js',
        publishConfig: {
          exports: './lib/index.js',
        },
        scripts: { prepack: 'node prepare.mjs' },
        dependencies,
        ...additional,
        packageManager: 'pnpm@12.0.0',
      },
      null,
      2,
    )}\n`,
  )
}

function packedManifest(tarball) {
  return JSON.parse(
    execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
  )
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'domain-qualification-'))
  await domain(root, 'producer', '@example/producer')
  await domain(root, 'consumer', '@example/consumer', { '@example/producer': '^1.0.0' })
  await writeFile(
    join(root, '.release-please-config.json'),
    '{"packages":{"producer":{},"consumer":{}}}\n',
  )
  await writeFile(
    join(root, '.release-please-manifest.json'),
    '{"producer":"1.0.0","consumer":"1.0.0"}\n',
  )
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'tests@astrale.ai'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Astrale tests'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

test('packs in derived order with an absent producer tarball', async () => {
  const root = await repository()
  const lookups = []
  const result = await qualifyDomains({
    root,
    registryLookup: async ({ name }) => {
      lookups.push(name)
      return 'absent'
    },
  })
  assert.deepEqual(result.plan.directories, ['producer', 'consumer'])
  assert.deepEqual(Object.keys(result.tarballs), ['producer', 'consumer'])
  assert.ok(lookups.includes('@example/producer'))
})

test('substitutes only absent internal dependencies', async () => {
  const producer = {
    name: '@example/producer',
    version: '1.0.0',
    manifest: {},
  }
  const dependent = {
    name: '@example/consumer',
    version: '1.0.0',
    manifest: { dependencies: { '@example/producer': '^1.0.0' } },
  }
  const unrelated = {
    name: '@example/unrelated',
    version: '1.0.0',
    manifest: {},
  }
  const input = {
    allByName: new Map([
      [producer.name, producer],
      [dependent.name, dependent],
      [unrelated.name, unrelated],
    ]),
    tarballsByName: new Map([[producer.name, '/tmp/producer.tgz']]),
    registry: 'https://registry.example',
    cwd: '/tmp',
    env: {},
  }

  assert.deepEqual(
    await overrideForDependencies({
      ...input,
      pkg: dependent,
      registryLookup: async () => 'absent',
    }),
    { '@example/producer': 'file:/tmp/producer.tgz' },
  )
  assert.deepEqual(
    await overrideForDependencies({
      ...input,
      pkg: dependent,
      registryLookup: async () => 'present',
    }),
    {},
  )
  assert.deepEqual(
    await overrideForDependencies({
      ...input,
      pkg: unrelated,
      registryLookup: async () => {
        throw new Error('unrelated package must not read registry state')
      },
    }),
    {},
  )
})

test('keeps qualifier tarball paths out of every packed dependency field', async () => {
  const root = await mkdtemp(join(tmpdir(), 'domain-restoration-'))
  await domain(root, 'producer', '@example/producer')
  await domain(root, 'required', '@example/required', { '@example/producer': '^1.0.0' })
  await domain(
    root,
    'optional',
    '@example/optional',
    {},
    {
      optionalDependencies: { '@example/producer': '~1.0.0' },
    },
  )
  await domain(
    root,
    'peer',
    '@example/peer',
    {},
    {
      peerDependencies: { '@example/producer': '>=1.0.0 <2.0.0' },
    },
  )
  await writeFile(
    join(root, '.release-please-config.json'),
    '{"packages":{"producer":{},"required":{},"optional":{},"peer":{}}}\n',
  )
  await writeFile(
    join(root, '.release-please-manifest.json'),
    '{"producer":"1.0.0","required":"1.0.0","optional":"1.0.0","peer":"1.0.0"}\n',
  )
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'tests@astrale.ai'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Astrale tests'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })

  const result = await qualifyDomains({ root, registryLookup: async () => 'absent' })
  const required = packedManifest(result.tarballs.required)
  const optional = packedManifest(result.tarballs.optional)
  const peer = packedManifest(result.tarballs.peer)
  assert.equal(required.dependencies['@example/producer'], '^1.0.0')
  assert.equal(optional.optionalDependencies['@example/producer'], '~1.0.0')
  assert.equal(peer.peerDependencies['@example/producer'], '>=1.0.0 <2.0.0')
  assert.doesNotMatch(JSON.stringify({ required, optional, peer }), /file:/u)
})

test('does not execute package-owned install lifecycle scripts during qualification', async () => {
  const root = await repository()
  const path = join(root, 'producer', 'package.json')
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'))
  manifest.scripts.postinstall = 'node -e "process.exit(97)"'
  await writeFile(path, `${JSON.stringify(manifest)}\n`)
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'install lifecycle trap'], { cwd: root })

  const result = await qualifyDomains({ root, registryLookup: async () => 'absent' })
  assert.deepEqual(Object.keys(result.tarballs), ['producer', 'consumer'])
})

test('rejects an incompatible selected producer version before installation', async () => {
  const root = await repository()
  const path = join(root, 'consumer', 'package.json')
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'))
  manifest.dependencies['@example/producer'] = '^2.0.0'
  await writeFile(path, `${JSON.stringify(manifest)}\n`)
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'incompatible'], { cwd: root })
  await assert.rejects(
    qualifyDomains({ root, registryLookup: async () => 'absent' }),
    /does not admit selected 1\.0\.0/u,
  )
})

test('rejects a Domain whose packed root fails in a clean consumer', async () => {
  const root = await repository()
  await writeFile(
    join(root, 'producer', 'prepare.mjs'),
    `import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('lib', { recursive: true })
await writeFile('lib/index.js', "export { missing } from 'missing-package'\\n")
`,
  )
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'break published declarations'], { cwd: root })

  await assert.rejects(
    qualifyDomains({ root, registryLookup: async () => 'absent' }),
    /Cannot find package 'missing-package'/u,
  )
})

test('registry reads distinguish absence from uncertainty', () => {
  assert.equal(
    classifyRegistryRead({ status: 1, stderr: 'npm error E404' }, 'a', '1.0.0'),
    'absent',
  )
  assert.equal(classifyRegistryRead({ status: 0, stdout: '1.0.0\n' }, 'a', '1.0.0'), 'present')
  assert.throws(
    () => classifyRegistryRead({ status: 1, stderr: 'ETIMEDOUT' }, 'a', '1.0.0'),
    /visibility is unknown/u,
  )
})
