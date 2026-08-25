import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  classifyRegistryRead,
  overrideForDependencies,
  qualifyDomainContracts,
} from './qualify.mjs'

async function contract(root, dir, name, dependencies = {}) {
  const project = join(root, dir)
  await mkdir(join(project, 'schema'), { recursive: true })
  await writeFile(join(project, 'astrale.config.ts'), 'export default {}\n')
  await writeFile(join(project, 'schema', 'index.ts'), 'export const schema = {}\n')
  await writeFile(
    join(project, 'prepare.mjs'),
    `import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('dist/schema', { recursive: true })
await writeFile('dist/schema/index.js', 'export const schema = {}\\n')
await writeFile('dist/schema/index.d.ts', 'export declare const schema: {}\\n')
`,
  )
  await writeFile(
    join(project, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: '1.0.0',
        type: 'module',
        files: ['dist'],
        main: './schema/index.ts',
        types: './schema/index.ts',
        exports: {
          '.': { types: './schema/index.ts', import: './schema/index.ts' },
          './package.json': './package.json',
        },
        publishConfig: {
          main: './dist/schema/index.js',
          types: './dist/schema/index.d.ts',
          exports: {
            '.': { types: './dist/schema/index.d.ts', import: './dist/schema/index.js' },
            './package.json': './package.json',
          },
        },
        scripts: { prepack: 'node prepare.mjs' },
        dependencies,
        packageManager: 'pnpm@11.13.1',
      },
      null,
      2,
    )}\n`,
  )
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'domain-qualification-'))
  await contract(root, 'producer', '@example/producer')
  await contract(root, 'consumer', '@example/consumer', { '@example/producer': '^1.0.0' })
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
  const result = await qualifyDomainContracts({
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

test('rejects an incompatible selected producer version before installation', async () => {
  const root = await repository()
  const path = join(root, 'consumer', 'package.json')
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'))
  manifest.dependencies['@example/producer'] = '^2.0.0'
  await writeFile(path, `${JSON.stringify(manifest)}\n`)
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'incompatible'], { cwd: root })
  await assert.rejects(
    qualifyDomainContracts({ root, registryLookup: async () => 'absent' }),
    /does not admit selected 1\.0\.0/u,
  )
})

test('rejects a tarball whose published declarations fail in a clean consumer', async () => {
  const root = await repository()
  await writeFile(
    join(root, 'producer', 'prepare.mjs'),
    `import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('dist/schema', { recursive: true })
await writeFile('dist/schema/index.js', 'export const schema = {}\\n')
await writeFile('dist/schema/index.d.ts', "export { Missing } from 'missing-package'\\nexport declare const schema: {}\\n")
`,
  )
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'break published declarations'], { cwd: root })

  await assert.rejects(
    qualifyDomainContracts({ root, registryLookup: async () => 'absent' }),
    /Cannot find module 'missing-package'/u,
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
