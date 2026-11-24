import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CONSUMER_PROBE } from './consumer.mjs'
import { admitDistTag, expectedTag, provePublishedDomains } from './registry.mjs'

test('derives stable and prerelease tags using the publisher policy', () => {
  assert.equal(expectedTag('1.2.3'), 'latest')
  assert.equal(expectedTag('1.2.3-beta.4'), 'beta')
  assert.equal(expectedTag('2.0.0-rc.1'), 'rc')
})

test('requires the release-channel dist-tag to resolve to the exact version', () => {
  assert.doesNotThrow(() =>
    admitDistTag({ name: '@example/domain', version: '1.2.3', tagsOutput: 'latest: 1.2.3\n' }),
  )
  assert.throws(
    () =>
      admitDistTag({ name: '@example/domain', version: '1.2.3', tagsOutput: 'latest: 1.2.2\n' }),
    /does not resolve/u,
  )
})

async function publishedRepository() {
  const root = await mkdtemp(join(tmpdir(), 'published-domain-'))
  await mkdir(join(root, 'domain'))
  await writeFile(join(root, 'domain', 'astrale.config.ts'), 'export default {}\n')
  await writeFile(
    join(root, 'domain', 'package.json'),
    `${JSON.stringify({ name: '@example/domain', version: '1.2.3' })}\n`,
  )
  await writeFile(join(root, '.release-please-config.json'), '{"packages":{"domain":{}}}\n')
  await writeFile(join(root, '.release-please-manifest.json'), '{"domain":"1.2.3"}\n')
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'tests@astrale.ai'],
    ['config', 'user.name', 'Astrale tests'],
    ['add', '.'],
    ['commit', '-qm', 'fixture'],
  ]) {
    execFileSync('git', args, { cwd: root })
  }
  return root
}

// Proves the fixture Domain against a registry that lists 1.2.3 and answers its tarball
// downloads in order; records registry reads, pauses and commands as one sequence.
async function prove(tarballAnswers) {
  const bytes = Buffer.from('domain tarball')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const tarball = 'https://registry.example/@example/domain/-/domain-1.2.3.tgz'
  const events = []
  const outcome = await provePublishedDomains({
    root: await publishedRepository(),
    selection: 'all',
    registry: 'https://registry.example',
    request: async (url) => {
      if (url !== tarball) {
        events.push('packument')
        return Response.json({ versions: { '1.2.3': { dist: { tarball, integrity } } } })
      }
      const answer = tarballAnswers.shift()
      events.push(`tarball ${answer}`)
      if (answer === 'corrupt') return new Response('other bytes')
      return answer === 200 ? new Response(bytes) : new Response(null, { status: answer })
    },
    clock: {
      now: () => 0,
      sleep: async () => events.push('pause'),
      timeout: () => new AbortController().signal,
    },
    run: (command, args) => {
      events.push(`${command} ${args[0]}`)
      return command === 'npm' ? 'latest: 1.2.3\n' : ''
    },
  }).catch((error) => error)
  return { outcome, events }
}

test('installs a published Domain once, after its tarball is served', async () => {
  const { outcome, events } = await prove([404, 200])

  assert.ifError(outcome instanceof Error ? outcome : undefined)
  assert.deepEqual(events, [
    'packument',
    'tarball 404',
    'pause',
    'packument',
    'tarball 200',
    'npm dist-tag',
    'pnpm install',
    'node --input-type=module',
  ])
})

test('fails closed without installing when the served tarball differs from its integrity', async () => {
  const { outcome, events } = await prove(['corrupt'])

  assert.match(outcome.message, /hashes to sha512-\S+, but its packument records/u)
  assert.deepEqual(events, ['packument', 'tarball corrupt'])
})

test('executes a generic clean consumer root without requiring named exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'domain-consumer-probe-'))
  const pkg = join(root, 'node_modules', '@example', 'domain')
  await mkdir(pkg, { recursive: true })
  await writeFile(join(pkg, 'index.js'), 'export const implementation = {}\n')
  await writeFile(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: '@example/domain',
      type: 'module',
      exports: './index.js',
    }),
  )

  const admitted = spawnSync(
    'node',
    ['--input-type=module', '-e', CONSUMER_PROBE, '@example/domain'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(admitted.status, 0, `${admitted.stdout}${admitted.stderr}`)

  await writeFile(join(pkg, 'index.js'), "throw new Error('broken root')\n")
  const brokenRoot = spawnSync(
    'node',
    ['--input-type=module', '-e', CONSUMER_PROBE, '@example/domain'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.notEqual(brokenRoot.status, 0)
  assert.match(brokenRoot.stderr, /broken root/u)
})
