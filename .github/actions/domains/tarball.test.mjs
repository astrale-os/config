import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { inspectDomainTarball } from './tarball.mjs'

async function archive({
  manifest = {
    name: '@example/domain',
    version: '1.2.3',
    type: 'module',
    exports: './lib/index.js',
  },
  files = { 'lib/index.js': 'export const value = 1\n' },
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'domain-tarball-'))
  const packageRoot = join(root, 'package')
  await mkdir(packageRoot)
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest))
  for (const [path, value] of Object.entries(files)) {
    await mkdir(join(packageRoot, path, '..'), { recursive: true })
    await writeFile(join(packageRoot, path), value)
  }
  const tarball = join(root, 'domain.tgz')
  execFileSync('tar', ['-czf', tarball, 'package'], { cwd: root })
  return tarball
}

test('verifies identity without prescribing Domain package layout or exports', async () => {
  const tarball = await archive({
    files: {
      'lib/index.js': 'export const value = 1\n',
      'lib/index.js.map': '{}',
      'runtime/worker.js': 'export {}\n',
    },
  })
  const result = inspectDomainTarball(tarball, {
    name: '@example/domain',
    version: '1.2.3',
  })
  assert.ok(result.files.includes('package/runtime/worker.js'))
  assert.ok(result.files.includes('package/lib/index.js.map'))
})

test('rejects a swapped package identity or version before publication', async () => {
  const tarball = await archive()
  assert.throws(
    () => inspectDomainTarball(tarball, { name: '@example/other', version: '1.2.3' }),
    /Packed package name/u,
  )
  assert.throws(
    () => inspectDomainTarball(tarball, { name: '@example/domain', version: '2.0.0' }),
    /Packed package version/u,
  )
})
