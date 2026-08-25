import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { discoverDomainContracts } from './discovery.mjs'

async function fixture(packages) {
  const root = await mkdtemp(join(tmpdir(), 'domain-discovery-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'tests@astrale.ai'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Astrale tests'], { cwd: root })
  const release = {}
  const manifest = {}

  for (const pkg of packages) {
    await mkdir(join(root, pkg.dir), { recursive: true })
    await writeFile(join(root, pkg.dir, 'astrale.config.ts'), 'export default {}\n')
    await writeFile(
      join(root, pkg.dir, 'package.json'),
      `${JSON.stringify({
        name: pkg.name,
        version: pkg.version ?? '1.0.0',
        private: pkg.private,
        dependencies: pkg.dependencies,
      })}\n`,
    )
    if (!pkg.private) {
      release[pkg.dir] = { component: pkg.dir }
      manifest[pkg.dir] = pkg.version ?? '1.0.0'
    }
  }
  await writeFile(
    join(root, '.release-please-config.json'),
    `${JSON.stringify({ packages: release })}\n`,
  )
  await writeFile(join(root, '.release-please-manifest.json'), `${JSON.stringify(manifest)}\n`)
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

test('discovers tracked public Domains and derives producer-first order', async () => {
  const root = await fixture([
    {
      dir: 'consumer',
      name: '@astrale-domains/consumer',
      dependencies: { '@astrale-domains/producer': '^1.0.0' },
    },
    { dir: 'producer', name: '@astrale-domains/producer' },
    { dir: 'private', name: '@astrale-domains/private', private: true },
  ])
  await mkdir(join(root, 'untracked'), { recursive: true })
  await writeFile(join(root, 'untracked', 'astrale.config.ts'), '')
  await writeFile(join(root, 'untracked', 'package.json'), '{"name":"untracked"}')

  const plan = await discoverDomainContracts({ root, repository: 'astrale-os/domains' })
  assert.deepEqual(plan.directories, ['producer', 'consumer'])
  assert.deepEqual(
    plan.packages.map(({ name }) => name),
    ['@astrale-domains/producer', '@astrale-domains/consumer'],
  )
})

test('requires the first-party name and exact release inventories', async () => {
  const wrongName = await fixture([{ dir: 'alpha', name: '@astrale-os/alpha' }])
  await assert.rejects(
    discoverDomainContracts({ root: wrongName, repository: 'astrale-os/domains' }),
    /must be named @astrale-domains\/alpha/u,
  )

  const stale = await fixture([{ dir: 'alpha', name: '@astrale-domains/alpha' }])
  await writeFile(
    join(stale, '.release-please-config.json'),
    '{"packages":{"alpha":{},"removed":{}}}\n',
  )
  await assert.rejects(
    discoverDomainContracts({ root: stale }),
    /must exactly equal public Domains/u,
  )
})

test('rejects duplicate names and dependency cycles', async () => {
  const duplicate = await fixture([
    { dir: 'alpha', name: '@example/shared' },
    { dir: 'beta', name: '@example/shared' },
  ])
  await assert.rejects(
    discoverDomainContracts({ root: duplicate }),
    /Duplicate public Domain package/u,
  )

  const cycle = await fixture([
    { dir: 'alpha', name: '@example/alpha', dependencies: { '@example/beta': '^1.0.0' } },
    { dir: 'beta', name: '@example/beta', dependencies: { '@example/alpha': '^1.0.0' } },
  ])
  await assert.rejects(discoverDomainContracts({ root: cycle }), /dependency cycle/u)
})

test('selects only manifest versions changed since the supplied commit', async () => {
  const root = await fixture([
    { dir: 'alpha', name: '@example/alpha' },
    { dir: 'beta', name: '@example/beta' },
  ])
  const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const alpha = join(root, 'alpha', 'package.json')
  await writeFile(alpha, '{"name":"@example/alpha","version":"1.1.0"}\n')
  await writeFile(join(root, '.release-please-manifest.json'), '{"alpha":"1.1.0","beta":"1.0.0"}\n')
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'release'], { cwd: root })

  const plan = await discoverDomainContracts({ root, selection: 'changed', before })
  assert.deepEqual(plan.selectedDirectories, ['alpha'])
})

test('ignores nested frontend configs', async () => {
  const root = await fixture([{ dir: 'alpha', name: '@example/alpha' }])
  await mkdir(join(root, 'alpha', 'frontend'), { recursive: true })
  await writeFile(join(root, 'alpha', 'frontend', 'astrale.config.ts'), '')
  await writeFile(join(root, 'alpha', 'frontend', 'package.json'), '{"name":"frontend"}\n')
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'nested frontend'], { cwd: root })

  const plan = await discoverDomainContracts({ root })
  assert.deepEqual(plan.directories, ['alpha'])
})
