import { spawnSync } from 'node:child_process'
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { CONSUMER_PROBE, writeContractConsumer } from './consumer.mjs'
import { discoverDomainContracts } from './discovery.mjs'

export function expectedTag(version) {
  const prerelease = version.includes('-')
    ? version.slice(version.indexOf('-') + 1).split('.')[0]
    : ''
  return prerelease || 'latest'
}

function run(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env, CI: '1' },
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${output}`)
  return output
}

export function admitRegistryMetadata({ name, version, versionOutput, tagsOutput }) {
  if (!versionOutput.split(/\r?\n/u).some((line) => line.trim() === version)) {
    throw new Error(`Immutable npm version is not visible: ${name}@${version}`)
  }
  const tag = expectedTag(version)
  if (!tagsOutput.split(/\r?\n/u).some((line) => line.trim() === `${tag}: ${version}`)) {
    throw new Error(`npm dist-tag ${name}@${tag} does not resolve to ${version}`)
  }
}

export async function provePublishedContracts({
  root = process.cwd(),
  repository = '',
  selection = 'changed',
  before = '',
  registry = 'https://registry.npmjs.org',
} = {}) {
  const plan = await discoverDomainContracts({ root, repository, selection, before })
  const scratch = await mkdtemp(join(tmpdir(), 'published-domain-contracts-'))
  const npmrc = join(scratch, 'npmrc')
  await writeFile(npmrc, `registry=${registry}\n@astrale-domains:registry=${registry}\n`)
  const env = {
    NPM_CONFIG_USERCONFIG: npmrc,
    NPM_CONFIG_REGISTRY: registry,
    NODE_AUTH_TOKEN: '',
    NPM_TOKEN: '',
  }

  for (const pkg of plan.selected) {
    const spec = `${pkg.name}@${pkg.version}`
    const versionOutput = run('pnpm', ['view', spec, 'version', `--registry=${registry}`], {
      cwd: scratch,
      env,
    })
    const tagsOutput = run('npm', ['dist-tag', 'ls', pkg.name, `--registry=${registry}`], {
      cwd: scratch,
      env,
    })
    admitRegistryMetadata({ ...pkg, versionOutput, tagsOutput })
    const consumer = await mkdtemp(join(scratch, 'consumer-'))
    await writeContractConsumer({
      directory: consumer,
      name: pkg.name,
      dependency: pkg.version,
    })
    run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: consumer, env })
    run('node', ['--input-type=module', '-e', CONSUMER_PROBE, pkg.name], { cwd: consumer, env })
    run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: consumer, env })
    console.log(`Published contract verified: ${spec}`)
  }
  return plan
}

async function main() {
  const plan = await provePublishedContracts({
    root: process.env.INPUT_ROOT || process.cwd(),
    repository: process.env.INPUT_REPOSITORY || process.env.GITHUB_REPOSITORY || '',
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
    console.error(`::error title=Published Domain contract proof failed::${error.message}`)
    process.exitCode = 1
  })
}
