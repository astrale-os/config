import { spawnSync } from 'node:child_process'
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { awaitVisibleVersion } from '../registry-visibility.mjs'
import { CONSUMER_PROBE, writeDomainConsumer } from './consumer.mjs'
import { discoverDomains } from './discovery.mjs'

export function expectedTag(version) {
  const prerelease = version.includes('-')
    ? version.slice(version.indexOf('-') + 1).split('.')[0]
    : ''
  return prerelease || 'latest'
}

function runCommand(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env, CI: '1' },
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${output}`)
  return output
}

export function admitDistTag({ name, version, tagsOutput }) {
  const tag = expectedTag(version)
  if (!tagsOutput.split(/\r?\n/u).some((line) => line.trim() === `${tag}: ${version}`)) {
    throw new Error(`npm dist-tag ${name}@${tag} does not resolve to ${version}`)
  }
}

export async function provePublishedDomains({
  root = process.cwd(),
  selection = 'changed',
  before = '',
  registry = 'https://registry.npmjs.org',
  run = runCommand,
  request,
  clock,
} = {}) {
  const plan = await discoverDomains({ root, selection, before })
  const scratch = await mkdtemp(join(tmpdir(), 'published-domains-'))
  const npmrc = join(scratch, 'npmrc')
  await writeFile(npmrc, `registry=${registry}\n`)
  const env = {
    NPM_CONFIG_USERCONFIG: npmrc,
    NPM_CONFIG_REGISTRY: registry,
    NODE_AUTH_TOKEN: '',
    NPM_TOKEN: '',
  }

  for (const pkg of plan.selected) {
    const spec = `${pkg.name}@${pkg.version}`
    // The consumer below resolves the version from the registry once, so it starts only
    // after the version is installable (bounded wait, fails closed).
    await awaitVisibleVersion({ name: pkg.name, version: pkg.version, registry, request, clock })
    const tagsOutput = run('npm', ['dist-tag', 'ls', pkg.name, `--registry=${registry}`], {
      cwd: scratch,
      env,
    })
    admitDistTag({ ...pkg, tagsOutput })
    const consumer = await mkdtemp(join(scratch, 'consumer-'))
    await writeDomainConsumer({
      directory: consumer,
      name: pkg.name,
      dependency: pkg.version,
    })
    run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: consumer, env })
    run('node', ['--input-type=module', '-e', CONSUMER_PROBE, pkg.name], { cwd: consumer, env })
    console.log(`Published Domain verified: ${spec}`)
  }
  return plan
}

async function main() {
  const plan = await provePublishedDomains({
    root: process.env.INPUT_ROOT || process.cwd(),
    selection: process.env.INPUT_SELECTION || 'changed',
    before: process.env.INPUT_BEFORE || '',
  })
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `verified=${JSON.stringify(plan.selected.length)}\n`,
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`::error title=Published Domain proof failed::${error.message}`)
    process.exitCode = 1
  })
}
