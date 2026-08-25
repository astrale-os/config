import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { inspectContractTarball } from './tarball.mjs'

const manifest = {
  name: '@example/domain',
  version: '1.2.3',
  type: 'module',
  main: './dist/schema/index.js',
  types: './dist/schema/index.d.ts',
  exports: {
    '.': { types: './dist/schema/index.d.ts', import: './dist/schema/index.js' },
    './package.json': './package.json',
  },
}

async function archive(extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'domain-tarball-'))
  const packageRoot = join(root, 'package')
  await mkdir(join(packageRoot, 'dist', 'schema'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(packageRoot, 'dist', 'schema', 'index.js'), 'export const schema = {}\n')
  await writeFile(
    join(packageRoot, 'dist', 'schema', 'index.d.ts'),
    'export declare const schema: {}\n',
  )
  for (const [path, value] of Object.entries(extra)) {
    await mkdir(join(packageRoot, path, '..'), { recursive: true })
    await writeFile(join(packageRoot, path), value)
  }
  const tarball = join(root, 'domain.tgz')
  execFileSync('tar', ['-czf', tarball, 'package'], { cwd: root })
  return tarball
}

test('admits only the root Schema closure and package documents', async () => {
  const result = inspectContractTarball(await archive({ 'README.md': '# Domain\n' }), {
    name: '@example/domain',
    version: '1.2.3',
  })
  assert.deepEqual(result.javascript, ['package/dist/schema/index.js'])
  assert.deepEqual(result.declarations, ['package/dist/schema/index.d.ts'])
})

test('rejects runtime, source-map, and extra export leakage', async () => {
  const runtime = await archive({ 'dist/runtime/index.js': 'export {}' })
  assert.throws(() => inspectContractTarball(runtime), /non-contract files/u)
  const sourceMap = await archive({ 'dist/schema/index.js.map': '{}' })
  assert.throws(() => inspectContractTarball(sourceMap), /contains source maps/u)
  const tarball = await archive()
  const root = await mkdtemp(join(tmpdir(), 'domain-bad-export-'))
  execFileSync('tar', ['-xzf', tarball], { cwd: root })
  await writeFile(
    join(root, 'package', 'package.json'),
    JSON.stringify({
      ...manifest,
      exports: { ...manifest.exports, './runtime': './dist/runtime.js' },
    }),
  )
  const changed = join(root, 'changed.tgz')
  execFileSync('tar', ['-czf', changed, 'package'], { cwd: root })
  assert.throws(() => inspectContractTarball(changed), /only the contract root/u)
})
