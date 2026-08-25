#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const NPM_REGISTRY = 'https://registry.npmjs.org'
const GITHUB_REGISTRY = 'https://npm.pkg.github.com'
const DEFAULT_ATTEMPTS = 60
const DEFAULT_DELAY_MS = 5_000

export async function mirrorPackages({
  cwd = process.cwd(),
  dirs,
  githubToken,
  repository,
  githubApiUrl = 'https://api.github.com',
  runnerTemp,
  summaryPath,
  run = runCommand,
  request = globalThis.fetch,
  wait = delay,
  environment = process.env,
  attempts = integerEnvironment('MIRROR_VERIFY_ATTEMPTS', DEFAULT_ATTEMPTS),
  delayMs = integerEnvironment('MIRROR_VERIFY_DELAY_MS', DEFAULT_DELAY_MS),
}) {
  if (!Array.isArray(dirs) || dirs.length === 0) fail('At least one mirror directory is required.')
  if (typeof githubToken !== 'string' || githubToken.length === 0) {
    fail('A GitHub Packages token is required before mirroring.')
  }
  if (environment.NPM_TOKEN || environment.NODE_AUTH_TOKEN) {
    fail('npm token authentication is forbidden during npm-to-GitHub mirroring.')
  }
  const repositoryParts = /^([^/]+)\/([^/]+)$/.exec(repository ?? '')
  if (repositoryParts === null) fail('Mirror repository must use owner/name form.')
  const [, owner] = repositoryParts
  const root = await mkdtemp(join(runnerTemp ?? tmpdir(), 'astrale-npm-mirror-'))
  const npmConfig = join(root, 'npm.npmrc')
  const githubConfig = join(root, 'github.npmrc')
  const runIsolated = (command, args, options = {}) => run(command, args, { ...options, cwd: root })
  const commandEnvironment = { ...environment }
  delete commandEnvironment.NPM_TOKEN
  delete commandEnvironment.NODE_AUTH_TOKEN
  delete commandEnvironment.MIRROR_GITHUB_TOKEN
  const githubCommandEnvironment = {
    ...commandEnvironment,
    NODE_AUTH_TOKEN: githubToken,
  }

  try {
    await writeFile(
      npmConfig,
      `registry=${NPM_REGISTRY}/\n@astrale-os:registry=${NPM_REGISTRY}/\nalways-auth=false\n`,
      { mode: 0o600 },
    )
    await writeFile(
      githubConfig,
      `registry=${GITHUB_REGISTRY}/\n@astrale-os:registry=${GITHUB_REGISTRY}/\n//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}\nalways-auth=true\n`,
      { mode: 0o600 },
    )

    const candidates = []
    for (const directory of dirs) {
      const manifest = JSON.parse(await readFile(resolve(cwd, directory, 'package.json'), 'utf8'))
      candidates.push(admitCandidate(directory, manifest, repository))
    }
    if (new Set(candidates.map(({ name }) => name)).size !== candidates.length) {
      fail('Mirror package names must be unique.')
    }

    // Admit every existing target before writing any package version.
    for (const candidate of candidates) {
      const metadata = await packageMetadata({
        owner,
        candidate,
        repository,
        githubApiUrl,
        githubToken,
        request,
        allowMissing: true,
      })
      candidate.targetVersion = registryVersion(
        candidate,
        githubConfig,
        runIsolated,
        githubCommandEnvironment,
        githubToken,
      )
      if (metadata === undefined && candidate.targetVersion === 'present') {
        fail(`GitHub package metadata is absent for existing version ${candidate.spec}.`)
      }
    }

    // Download and authenticate the entire npm source set before the first GitHub write.
    for (const candidate of candidates) {
      candidate.source = await sourceArtifact({
        candidate,
        root,
        npmConfig,
        run: runIsolated,
        commandEnvironment,
        githubToken,
      })
    }

    for (const candidate of candidates) {
      await mirrorOne({
        candidate,
        owner,
        repository,
        githubApiUrl,
        githubToken,
        githubConfig,
        root,
        run: runIsolated,
        request,
        wait,
        attempts,
        delayMs,
        commandEnvironment: githubCommandEnvironment,
      })
      await appendSummary(summaryPath, `- \`${candidate.spec}\` -> private GitHub Packages`)
    }
    await appendSummary(summaryPath, '## Private GitHub Packages mirror complete', true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function admitCandidate(directory, manifest, repository) {
  const name = manifest?.name
  const version = manifest?.version
  if (typeof name !== 'string' || !name.startsWith('@astrale-os/')) {
    fail(`Mirror package in ${directory} must use the @astrale-os scope.`)
  }
  if (manifest.private === true) fail(`Mirror package ${name} is private in its npm manifest.`)
  const registry = manifest.publishConfig?.registry
  if (
    manifest.publishConfig?.access === 'restricted' ||
    (registry !== undefined && registryOrigin(registry) !== NPM_REGISTRY)
  ) {
    fail(`Mirror package ${name} is not an npm-public package.`)
  }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    fail(`Mirror package ${name} has no exact registry version.`)
  }
  if (repositoryOf(manifest.repository) !== repository) {
    fail(`Mirror package ${name} is not linked to repository ${repository}.`)
  }
  return {
    directory,
    name,
    slug: name.slice('@astrale-os/'.length),
    version,
    spec: `${name}@${version}`,
  }
}

function registryOrigin(input) {
  if (typeof input !== 'string') return undefined
  try {
    return new URL(input).origin.toLowerCase()
  } catch {
    return undefined
  }
}

function repositoryOf(input) {
  const value = typeof input === 'string' ? input : input?.url
  if (typeof value !== 'string') return undefined
  return value
    .replace(/^git\+https:\/\/github\.com\//u, '')
    .replace(/^https:\/\/github\.com\//u, '')
    .replace(/\.git$/u, '')
}

async function sourceArtifact({
  candidate,
  root,
  npmConfig,
  run,
  commandEnvironment,
  githubToken,
}) {
  const metadata = npmJson(
    executeNpm(
      run,
      [
        'view',
        candidate.spec,
        'name',
        'version',
        'dist.integrity',
        '--json',
        '--registry',
        NPM_REGISTRY,
      ],
      npmConfig,
      commandEnvironment,
      githubToken,
    ),
    `npm metadata for ${candidate.spec}`,
  )
  if (
    metadata?.name !== candidate.name ||
    metadata?.version !== candidate.version ||
    typeof metadata?.['dist.integrity'] !== 'string' ||
    !metadata['dist.integrity'].startsWith('sha512-')
  ) {
    fail(`npm metadata for ${candidate.spec} is incomplete or disagrees with its manifest.`)
  }
  const tags = parseDistTags(
    executeNpm(
      run,
      ['dist-tag', 'ls', candidate.name, '--registry', NPM_REGISTRY],
      npmConfig,
      commandEnvironment,
      githubToken,
    ).stdout,
  )
  const releaseTags = [...tags]
    .filter(([, version]) => version === candidate.version)
    .map(([tag]) => tag)
    .sort()
  if (releaseTags.length === 0) fail(`npm has no release-channel tag for ${candidate.spec}.`)

  const destination = join(root, 'npm', candidate.slug)
  await mkdir(destination, { recursive: true })
  const packed = npmJson(
    executeNpm(
      run,
      [
        'pack',
        candidate.spec,
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        destination,
        '--registry',
        NPM_REGISTRY,
      ],
      npmConfig,
      commandEnvironment,
      githubToken,
    ),
    `npm tarball for ${candidate.spec}`,
  )
  const entry = Array.isArray(packed) ? packed[0] : undefined
  if (entry?.name !== candidate.name || entry?.version !== candidate.version) {
    fail(`Downloaded npm tarball metadata disagrees with ${candidate.spec}.`)
  }
  const path = join(destination, basename(entry.filename ?? ''))
  const integrity = await sha512(path)
  if (integrity !== metadata['dist.integrity'] || entry.integrity !== integrity) {
    fail(`Downloaded npm tarball integrity disagrees with npm for ${candidate.spec}.`)
  }
  return { path, integrity, releaseTags }
}

async function mirrorOne({
  candidate,
  owner,
  repository,
  githubApiUrl,
  githubToken,
  githubConfig,
  root,
  run,
  request,
  wait,
  attempts,
  delayMs,
  commandEnvironment,
}) {
  let publishEvidence
  if (candidate.targetVersion === 'missing') {
    const initialTag = candidate.source.releaseTags[0]
    const result = runNpm(
      run,
      [
        'publish',
        candidate.source.path,
        '--access=restricted',
        '--tag',
        initialTag,
        '--registry',
        GITHUB_REGISTRY,
      ],
      githubConfig,
      commandEnvironment,
    )
    publishEvidence = redactTail(result.output, githubToken) || '<empty>'
    if (
      result.status !== 0 &&
      !/already exists|cannot publish over|EPUBLISHCONFLICT|409 Conflict/iu.test(result.output)
    ) {
      fail(
        `GitHub Packages publish failed for ${candidate.spec}: ${redact(result.output, githubToken)}`,
      )
    }
  }

  const destination = join(root, 'github', candidate.slug)
  await mkdir(destination, { recursive: true })
  const target = await retry(
    async () => {
      const result = runNpm(
        run,
        [
          'pack',
          candidate.spec,
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          destination,
          '--registry',
          GITHUB_REGISTRY,
        ],
        githubConfig,
        commandEnvironment,
      )
      if (result.status !== 0) {
        if (/E404|404 Not Found/iu.test(result.output)) return undefined
        fail(
          `GitHub Packages download failed for ${candidate.spec}: ${redact(result.output, githubToken)}`,
        )
      }
      const packed = npmJson(result, `GitHub tarball for ${candidate.spec}`)
      const entry = Array.isArray(packed) ? packed[0] : undefined
      if (entry?.name !== candidate.name || entry?.version !== candidate.version) {
        fail(`GitHub Packages downloaded the wrong package for ${candidate.spec}.`)
      }
      return join(destination, basename(entry.filename ?? ''))
    },
    { attempts, delayMs, wait },
  )
  if (target === undefined) {
    const evidence = publishEvidence ? ` Publish command output: ${publishEvidence}` : ''
    fail(`GitHub Packages version ${candidate.spec} is not downloadable.${evidence}`)
  }
  if ((await sha512(target)) !== candidate.source.integrity) {
    fail(`GitHub Packages tarball differs from authoritative npm artifact ${candidate.spec}.`)
  }

  const metadata = await retry(
    () =>
      packageMetadata({
        owner,
        candidate,
        repository,
        githubApiUrl,
        githubToken,
        request,
        allowMissing: true,
      }),
    { attempts, delayMs, wait },
  )
  if (metadata === undefined) fail(`GitHub package metadata is absent for ${candidate.name}.`)

  for (const tag of candidate.source.releaseTags) {
    const tags = await retry(
      () => githubTags(candidate, githubConfig, run, commandEnvironment, githubToken),
      { attempts, delayMs, wait },
    )
    if (tags === undefined) fail(`GitHub Packages tags are not readable for ${candidate.name}.`)
    if (tags.get(tag) !== candidate.version) {
      executeNpm(
        run,
        ['dist-tag', 'add', candidate.spec, tag, '--registry', GITHUB_REGISTRY],
        githubConfig,
        commandEnvironment,
        githubToken,
      )
    }
    const verified = await retry(
      async () => {
        const current = await githubTags(
          candidate,
          githubConfig,
          run,
          commandEnvironment,
          githubToken,
        )
        if (current === undefined) return undefined
        return current.get(tag) === candidate.version ? true : undefined
      },
      { attempts, delayMs, wait },
    )
    if (verified !== true)
      fail(`GitHub Packages tag ${candidate.name}@${tag} is not ${candidate.version}.`)
  }
}

function githubTags(candidate, config, run, environment, githubToken) {
  const result = runNpm(
    run,
    ['dist-tag', 'ls', candidate.name, '--registry', GITHUB_REGISTRY],
    config,
    environment,
  )
  if (result.status === 0) return parseDistTags(result.stdout)
  if (/E404|404 Not Found/iu.test(result.output)) return undefined
  fail(
    `GitHub Packages tag lookup failed for ${candidate.name}: ${redact(result.output, githubToken)}`,
  )
}

function registryVersion(candidate, config, run, environment, githubToken) {
  const result = runNpm(
    run,
    ['view', candidate.spec, 'version', '--json', '--registry', GITHUB_REGISTRY],
    config,
    environment,
  )
  if (result.status === 0) {
    const version = JSON.parse(result.stdout)
    if (version !== candidate.version)
      fail(`GitHub Packages returned the wrong version for ${candidate.spec}.`)
    return 'present'
  }
  if (/E404|404 Not Found/iu.test(result.output)) return 'missing'
  fail(`GitHub Packages lookup failed for ${candidate.spec}: ${redact(result.output, githubToken)}`)
}

async function packageMetadata({
  owner,
  candidate,
  repository,
  githubApiUrl,
  githubToken,
  request,
  allowMissing,
}) {
  const response = await request(
    `${githubApiUrl}/orgs/${encodeURIComponent(owner)}/packages/npm/${encodeURIComponent(candidate.slug)}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'x-github-api-version': '2022-11-28',
      },
    },
  )
  if (response.status === 404 && allowMissing) return undefined
  if (!response.ok)
    fail(`GitHub package metadata request failed for ${candidate.name} (${response.status}).`)
  const metadata = await response.json()
  if (metadata.visibility !== 'private')
    fail(`GitHub package ${candidate.name} must remain private.`)
  // Repository-scoped GITHUB_TOKEN responses omit `repository`; linkage is an
  // externally attested provisioning precondition. The released manifest owns
  // source identity here. Reject every contradictory API projection while
  // allowing only the token-scoped omission.
  if (Object.hasOwn(metadata, 'repository') && metadata.repository?.full_name !== repository) {
    fail(`GitHub package ${candidate.name} must be linked to ${repository}.`)
  }
  return metadata
}

function executeNpm(run, args, config, environment, githubToken) {
  const result = runNpm(run, args, config, environment)
  if (result.status !== 0) {
    fail(`npm ${args[0]} failed: ${redact(result.output, githubToken)}`)
  }
  return result
}

function runNpm(run, args, config, environment) {
  return run('npm', args, {
    env: { ...environment, NPM_CONFIG_USERCONFIG: config },
  })
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

function npmJson(result, label) {
  if (result.status !== 0) fail(`${label} is unavailable: ${result.output}`)
  try {
    return JSON.parse(result.stdout)
  } catch {
    fail(`${label} is not valid JSON.`)
  }
}

export function parseDistTags(input) {
  const tags = new Map()
  for (const line of input.split('\n')) {
    const match = /^([^:\s]+):\s+(.+)$/u.exec(line.trim())
    if (match !== null) tags.set(match[1], match[2])
  }
  return tags
}

async function sha512(path) {
  return `sha512-${createHash('sha512')
    .update(await readFile(path))
    .digest('base64')}`
}

async function retry(operation, { attempts, delayMs, wait }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const value = await operation()
    if (value !== undefined) return value
    if (attempt < attempts) await wait(delayMs)
  }
  return undefined
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function redact(input, token) {
  return redactSecret(input, token).replaceAll('\n', ' ').slice(0, 500)
}

function redactTail(input, token) {
  return redactSecret(input, token).replaceAll('\n', ' ').slice(-500)
}

function redactSecret(input, token) {
  return token.length === 0 ? String(input) : String(input).replaceAll(token, '[REDACTED]')
}

async function appendSummary(path, line, heading = false) {
  if (!path) return
  const previous = await readFile(path, 'utf8').catch(() => '')
  const value = heading ? `${line}\n\n${previous}` : `${previous}${line}\n`
  await writeFile(path, value)
}

function integerEnvironment(name, fallback) {
  const input = process.env[name]
  if (input === undefined) return fallback
  const value = Number(input)
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive safe integer.`)
  return value
}

function fail(message) {
  throw new TypeError(message)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  mirrorPackages({
    dirs: (process.env.MIRROR_DIRS ?? '').split(/\s+/u).filter(Boolean),
    githubToken: process.env.MIRROR_GITHUB_TOKEN ?? '',
    repository: process.env.MIRROR_REPOSITORY,
    githubApiUrl: process.env.MIRROR_GITHUB_API_URL,
    runnerTemp: process.env.RUNNER_TEMP,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  }).catch((error) => {
    console.error(
      `::error title=Private package mirror failed::${redact(error?.message ?? error, process.env.MIRROR_GITHUB_TOKEN ?? '')}`,
    )
    process.exitCode = 1
  })
}
