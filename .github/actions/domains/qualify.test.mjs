import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { overrideForDependencies, qualifyDomains, registryState } from './qualify.mjs'

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
        packageManager: 'pnpm@12.1.0',
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

test('a listed producer is present only once it is installable', async () => {
  const bytes = Buffer.from('producer tarball')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const tarball = 'https://registry.example/a/-/a-1.0.0.tgz'
  const listed = () => Response.json({ versions: { '1.0.0': { dist: { tarball, integrity } } } })
  const missing = () => new Response(null, { status: 404 })
  async function lookup(answers) {
    const requests = []
    const sleeps = []
    const state = await registryState({
      name: 'a',
      version: '1.0.0',
      registry: 'https://registry.example',
      request: async (url) => {
        requests.push(url)
        return answers.shift()
      },
      clock: {
        now: () => 0,
        sleep: async (milliseconds) => sleeps.push(milliseconds),
        timeout: () => new AbortController().signal,
      },
    }).catch((error) => error)
    return { state, requests: requests.length, sleeps }
  }

  // An unlisted producer is qualified from its local tarball, without waiting.
  assert.deepEqual(await lookup([missing()]), { state: 'absent', requests: 1, sleeps: [] })
  // A registry that answers neither way stops qualification at once.
  const unknown = await lookup([new Response(null, { status: 503 })])
  assert.match(
    unknown.state.message,
    /^Registry visibility is unknown for a@1\.0\.0: .* HTTP 503$/u,
  )
  assert.deepEqual(unknown.sleeps, [])
  // A listed producer whose tarball is not served yet is waited for.
  assert.deepEqual(
    await lookup([listed(), missing(), listed(), missing(), listed(), new Response(bytes)]),
    { state: 'present', requests: 6, sleeps: [10_000] },
  )
  // A listed producer whose served bytes differ from dist.integrity fails closed.
  const corrupt = await lookup([listed(), new Response('other bytes')])
  assert.match(corrupt.state.message, /hashes to sha512-\S+, but its packument records/u)
  assert.deepEqual(corrupt.sleeps, [])
})
