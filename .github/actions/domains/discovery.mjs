import { execFileSync } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']
const CONFIG_PATTERN = /(?:^|\/)astrale\.config\.[^/]+$/u
const EXCLUDED_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'coverage', 'frontend'])

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
}

async function json(path, label = path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`)
  }
}

function normalizedDirectory(value) {
  const normalized = posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//u, '')
  if (normalized === '' || normalized === '.') return '.'
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error(`Release inventory path escapes the repository: ${value}`)
  }
  return normalized.replace(/\/$/u, '')
}

function trackedDirectory(configPath) {
  const directory = dirname(configPath)
  return directory === '' ? '.' : normalizedDirectory(directory)
}

function isExcluded(directory) {
  return directory.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment))
}

function dependencyNames(manifest) {
  return DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}))
}

export function topologicalOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]))
  const dependencies = new Map()
  const consumers = new Map(packages.map((pkg) => [pkg.name, []]))

  for (const pkg of packages) {
    const internal = [
      ...new Set(dependencyNames(pkg.manifest).filter((name) => byName.has(name))),
    ].sort()
    dependencies.set(pkg.name, new Set(internal))
    for (const producer of internal) consumers.get(producer).push(pkg.name)
  }

  const ready = packages
    .filter((pkg) => dependencies.get(pkg.name).size === 0)
    .map((pkg) => pkg.name)
    .sort()
  const ordered = []

  while (ready.length > 0) {
    const name = ready.shift()
    ordered.push(byName.get(name))
    for (const consumer of consumers.get(name).sort()) {
      const remaining = dependencies.get(consumer)
      remaining.delete(name)
      if (remaining.size === 0) {
        ready.push(consumer)
        ready.sort()
      }
    }
  }

  if (ordered.length !== packages.length) {
    const cycle = packages
      .filter((pkg) => dependencies.get(pkg.name).size > 0)
      .map((pkg) => `${pkg.name} -> ${[...dependencies.get(pkg.name)].sort().join(', ')}`)
      .sort()
    throw new Error(`Domain dependency cycle:\n- ${cycle.join('\n- ')}`)
  }
  return ordered
}

function previousVersion(root, before, directory) {
  if (!before || /^0+$/u.test(before)) return undefined
  const manifestPath = directory === '.' ? 'package.json' : `${directory}/package.json`
  try {
    const value = JSON.parse(git(root, ['show', `${before}:${manifestPath}`]))
    return typeof value.version === 'string' ? value.version : undefined
  } catch {
    return undefined
  }
}

export async function discoverDomains({
  root = process.cwd(),
  selection = 'all',
  before = '',
} = {}) {
  if (!['all', 'changed', 'none'].includes(selection)) {
    throw new Error(`Unknown Domain selection: ${selection}`)
  }

  const absoluteRoot = resolve(root)
  const tracked = git(absoluteRoot, ['ls-files', '-z']).split('\0').filter(Boolean)
  const trackedSet = new Set(tracked)
  const directories = [
    ...new Set(
      tracked
        .filter((path) => CONFIG_PATTERN.test(path))
        .map(trackedDirectory)
        .filter((directory) => !isExcluded(directory)),
    ),
  ].sort()

  const candidates = []
  for (const directory of directories) {
    const manifestPath = directory === '.' ? 'package.json' : `${directory}/package.json`
    if (!trackedSet.has(manifestPath)) continue
    const manifest = await json(resolve(absoluteRoot, manifestPath), manifestPath)
    if (manifest.private === true) continue
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`Public Domain ${directory} has no package name`)
    }
    if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
      throw new Error(`Public Domain ${directory} has no package version`)
    }
    candidates.push({ directory, name: manifest.name, version: manifest.version, manifest })
  }

  const names = new Map()
  for (const candidate of candidates) {
    const previous = names.get(candidate.name)
    if (previous) {
      throw new Error(
        `Duplicate public Domain package ${candidate.name}: ${previous} and ${candidate.directory}`,
      )
    }
    names.set(candidate.name, candidate.directory)
  }

  const releaseConfig = await json(
    resolve(absoluteRoot, '.release-please-config.json'),
    '.release-please-config.json',
  )
  const releaseManifest = await json(
    resolve(absoluteRoot, '.release-please-manifest.json'),
    '.release-please-manifest.json',
  )
  const inventory = Object.keys(releaseConfig.packages ?? {})
    .map(normalizedDirectory)
    .sort()
  const manifestDirectories = Object.keys(releaseManifest).map(normalizedDirectory).sort()
  const eligible = candidates.map(({ directory }) => directory).sort()

  if (JSON.stringify(inventory) !== JSON.stringify(eligible)) {
    throw new Error(
      `Release Please packages must exactly equal public Domains; expected ${eligible.join(', ') || '(none)'}, found ${inventory.join(', ') || '(none)'}`,
    )
  }
  if (JSON.stringify(manifestDirectories) !== JSON.stringify(eligible)) {
    throw new Error(
      `Release Please manifest must exactly equal public Domains; expected ${eligible.join(', ') || '(none)'}, found ${manifestDirectories.join(', ') || '(none)'}`,
    )
  }
  for (const candidate of candidates) {
    if (releaseManifest[candidate.directory] !== candidate.version) {
      throw new Error(
        `Release Please version for ${candidate.directory} is ${releaseManifest[candidate.directory] ?? '(missing)'}; package.json is ${candidate.version}`,
      )
    }
  }

  const ordered = topologicalOrder(
    candidates.map((candidate) => ({ ...candidate, dir: candidate.directory })),
  )
  const selected = ordered.filter((pkg) => {
    if (selection === 'all') return true
    if (selection === 'none') return false
    return previousVersion(absoluteRoot, before, pkg.directory) !== pkg.version
  })
  const projection = (pkg) => ({ dir: pkg.directory, name: pkg.name, version: pkg.version })

  return {
    packages: ordered.map(projection),
    selected: selected.map(projection),
    directories: ordered.map(({ directory }) => directory),
    selectedDirectories: selected.map(({ directory }) => directory),
  }
}

async function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${name}=${JSON.stringify(value)}\n`)
  }
}

async function main() {
  const plan = await discoverDomains({
    root: process.env.INPUT_ROOT || process.cwd(),
    selection: process.env.INPUT_SELECTION || 'all',
    before: process.env.INPUT_BEFORE || '',
  })
  await writeOutput('plan', plan)
  await writeOutput('dirs', plan.directories.join(' '))
  await writeOutput('selected-dirs', plan.selectedDirectories.join(' '))
  await writeOutput('has-selected', plan.selected.length > 0)
  console.log(JSON.stringify(plan, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`::error title=Domain discovery failed::${error.message}`)
    process.exitCode = 1
  })
}
