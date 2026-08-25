import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CONSUMER_PROBE } from './consumer.mjs'
import { admitRegistryMetadata, expectedTag } from './registry.mjs'

test('derives stable and prerelease tags using the publisher policy', () => {
  assert.equal(expectedTag('1.2.3'), 'latest')
  assert.equal(expectedTag('1.2.3-beta.4'), 'beta')
  assert.equal(expectedTag('2.0.0-rc.1'), 'rc')
})

test('requires exact immutable version and dist-tag evidence', () => {
  assert.doesNotThrow(() =>
    admitRegistryMetadata({
      name: '@example/domain',
      version: '1.2.3',
      versionOutput: '1.2.3\n',
      tagsOutput: 'latest: 1.2.3\n',
    }),
  )
  assert.throws(
    () =>
      admitRegistryMetadata({
        name: '@example/domain',
        version: '1.2.3',
        versionOutput: '1.2.2\n',
        tagsOutput: 'latest: 1.2.3\n',
      }),
    /Immutable npm version is not visible/u,
  )
  assert.throws(
    () =>
      admitRegistryMetadata({
        name: '@example/domain',
        version: '1.2.3',
        versionOutput: '1.2.3\n',
        tagsOutput: 'latest: 1.2.2\n',
      }),
    /does not resolve/u,
  )
})

test('executes the clean consumer root and package-metadata probe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'domain-consumer-probe-'))
  const pkg = join(root, 'node_modules', '@example', 'domain')
  await mkdir(pkg, { recursive: true })
  await writeFile(join(pkg, 'index.js'), 'export const schema = {}\n')
  await writeFile(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: '@example/domain',
      type: 'module',
      exports: { '.': './index.js', './package.json': './package.json' },
    }),
  )

  const admitted = spawnSync(
    'node',
    ['--input-type=module', '-e', CONSUMER_PROBE, '@example/domain'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(admitted.status, 0, `${admitted.stdout}${admitted.stderr}`)

  await writeFile(join(pkg, 'index.js'), 'export const implementation = {}\n')
  const missingSchema = spawnSync(
    'node',
    ['--input-type=module', '-e', CONSUMER_PROBE, '@example/domain'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.notEqual(missingSchema.status, 0)
  assert.match(missingSchema.stderr, /root export has no schema/u)

  await writeFile(join(pkg, 'index.js'), 'export const schema = {}\n')
  await writeFile(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: '@example/wrong-domain',
      type: 'module',
      exports: { '.': './index.js', './package.json': './package.json' },
    }),
  )
  const wrongIdentity = spawnSync(
    'node',
    ['--input-type=module', '-e', CONSUMER_PROBE, '@example/domain'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.notEqual(wrongIdentity.status, 0)
  assert.match(wrongIdentity.stderr, /package metadata identity mismatch/u)
})
