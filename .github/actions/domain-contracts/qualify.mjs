import { execFileSync, spawnSync } from 'node:child_process'
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { CONSUMER_PROBE, writeContractConsumer } from './consumer.mjs'
import { discoverDomainContracts } from './discovery.mjs'
import { satisfies } from './semver.mjs'
import { inspectContractTarball } from './tarball.mjs'

const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

function run(command, args, { cwd, env = {}, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env, CI: '1' },
    maxBuffer: 20 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}:\n${output}`)
  }
  if (!quiet && output.trim()) process.stdout.write(output)
  return output
}

function tracked(root, directory) {
  const args = ['-C', root, 'ls-files', '-z']
  if (directory !== '.') args.push('--', directory)
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean)
}

async function copyTrackedProject(root, directory, destination) {
  const prefix = directory === '.' ? '' : `${directory}/`
  for (const sourcePath of tracked(root, directory)) {
    if (prefix && !sourcePath.startsWith(prefix)) continue
    const projectPath = prefix ? sourcePath.slice(prefix.length) : sourcePath
    const target = join(destination, projectPath)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(resolve(root, sourcePath), target)
  }
}

function dependencyRanges(manifest, name) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    manifest[field]?.[name] === undefined ? [] : [{ field, range: manifest[field][name] }],
  )
}

export function classifyRegistryRead(result, name, version) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status === 0) {
    if (output.split(/\r?\n/u).some((line) => line.trim() === version)) return 'present'
    throw new Error(
      `Registry returned an unexpected version for ${name}@${version}: ${output.trim()}`,
    )
  }
  if (/E404|\b404\b|No match found|not found/iu.test(output)) return 'absent'
  throw new Error(`Registry visibility is unknown for ${name}@${version}: ${output.trim()}`)
}

function defaultRegistryLookup({ name, version, registry, cwd, env }) {
  return classifyRegistryRead(
    spawnSync('pnpm', ['view', `${name}@${version}`, 'version', `--registry=${registry}`], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env, CI: '1' },
    }),
    name,
    version,
  )
}

export async function overrideForDependencies({
  pkg,
  allByName,
  tarballsByName,
  registryLookup,
  registry,
  cwd,
  env,
}) {
  const overrides = {}
  for (const producer of allByName.values()) {
    const ranges = dependencyRanges(pkg.manifest, producer.name)
    if (ranges.length === 0) continue
    for (const { field, range } of ranges) {
      if (!satisfies(producer.version, range)) {
        throw new Error(
          `${pkg.name} ${field} range ${producer.name}@${range} does not admit selected ${producer.version}`,
        )
      }
    }
    const state = await registryLookup({
      name: producer.name,
      version: producer.version,
      registry,
      cwd,
      env,
    })
    if (state === 'present') continue
    if (state !== 'absent') throw new Error(`Unknown registry state ${state} for ${producer.name}`)
    const tarball = tarballsByName.get(producer.name)
    if (!tarball) {
      throw new Error(
        `${pkg.name} needs unpublished ${producer.name}@${producer.version}, but no producer tarball is available`,
      )
    }
    overrides[producer.name] = `file:${tarball}`
  }
  return overrides
}

async function temporaryDependencyTarballs(project, overrides) {
  if (Object.keys(overrides).length === 0) return async () => {}
  const path = join(project, 'package.json')
  const original = await readFile(path, 'utf8')
  const manifest = JSON.parse(original)
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (overrides[name]) manifest[field][name] = overrides[name]
    }
  }
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return async () => writeFile(path, original)
}

async function packedTarball(packDirectory) {
  const files = (await readdir(packDirectory)).filter((file) => file.endsWith('.tgz'))
  if (files.length !== 1) {
    throw new Error(`Expected one package tarball in ${packDirectory}; found ${files.join(', ')}`)
  }
  return resolve(packDirectory, files[0])
}

async function proveConsumer({
  pkg,
  tarball,
  tarballsByName,
  allByName,
  root,
  registry,
  env,
  registryLookup,
}) {
  const consumer = await mkdtemp(join(root, `consumer-${basename(pkg.directory)}-`))
  const overrides = await overrideForDependencies({
    pkg,
    allByName,
    tarballsByName,
    registryLookup,
    registry,
    cwd: consumer,
    env,
  })
  await writeContractConsumer({
    directory: consumer,
    name: pkg.name,
    dependency: `file:${tarball}`,
    overrides,
  })
  run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: consumer,
    env,
    quiet: true,
  })
  run('node', ['--input-type=module', '-e', CONSUMER_PROBE, pkg.name], {
    cwd: consumer,
    env,
    quiet: true,
  })
  run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: consumer, env, quiet: true })
}

export async function qualifyDomainContracts({
  root = process.cwd(),
  repository = '',
  selection = 'all',
  before = '',
  outputDirectory,
  registry = 'https://registry.npmjs.org',
  registryLookup = defaultRegistryLookup,
} = {}) {
  const absoluteRoot = resolve(root)
  const plan = await discoverDomainContracts({ root: absoluteRoot, repository, selection, before })
  const selectedNames = new Set(plan.selected.map(({ name }) => name))
  const discoveredByDirectory = new Map()
  for (const pkg of plan.packages) {
    const manifest = JSON.parse(
      await readFile(
        resolve(
          absoluteRoot,
          pkg.dir === '.' ? 'package.json' : pkg.dir,
          pkg.dir === '.' ? '' : 'package.json',
        ),
        'utf8',
      ),
    )
    discoveredByDirectory.set(pkg.dir, { ...pkg, directory: pkg.dir, manifest })
  }
  const targets = plan.packages
    .filter(({ name }) => selectedNames.has(name))
    .map(({ dir }) => discoveredByDirectory.get(dir))
  const allByName = new Map([...discoveredByDirectory.values()].map((pkg) => [pkg.name, pkg]))
  const output = resolve(outputDirectory ?? (await mkdtemp(join(tmpdir(), 'domain-contracts-'))))
  const projects = join(output, 'projects')
  const packs = join(output, 'packs')
  await mkdir(projects, { recursive: true })
  await mkdir(packs, { recursive: true })
  const npmrc = join(output, 'npmrc')
  await writeFile(
    npmrc,
    `registry=${registry}\n@astrale-os:registry=${registry}\n@astrale-domains:registry=${registry}\n`,
  )
  const env = {
    NPM_CONFIG_USERCONFIG: npmrc,
    NPM_CONFIG_REGISTRY: registry,
    NODE_AUTH_TOKEN: '',
    NPM_TOKEN: '',
  }
  const tarballsByName = new Map()
  const tarballsByDirectory = {}

  for (const pkg of targets) {
    console.log(`Qualifying ${pkg.name}@${pkg.version}`)
    const project = join(
      projects,
      pkg.directory === '.' ? '_root' : pkg.directory.replaceAll('/', '__'),
    )
    await mkdir(project, { recursive: true })
    await copyTrackedProject(absoluteRoot, pkg.directory, project)
    const overrides = await overrideForDependencies({
      pkg,
      allByName,
      tarballsByName,
      registryLookup,
      registry,
      cwd: project,
      env,
    })
    const restoreDependencies = await temporaryDependencyTarballs(project, overrides)
    run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
      cwd: project,
      env,
      quiet: true,
    })
    await restoreDependencies()
    const packDirectory = join(
      packs,
      pkg.directory === '.' ? '_root' : pkg.directory.replaceAll('/', '__'),
    )
    await mkdir(packDirectory, { recursive: true })
    run('pnpm', ['pack', '--pack-destination', packDirectory], { cwd: project, env, quiet: true })
    const tarball = await packedTarball(packDirectory)
    inspectContractTarball(tarball, pkg)
    tarballsByName.set(pkg.name, tarball)
    tarballsByDirectory[pkg.directory] = tarball
    await proveConsumer({
      pkg,
      tarball,
      tarballsByName,
      allByName,
      root: output,
      registry,
      env,
      registryLookup,
    })
  }

  return { plan, tarballs: tarballsByDirectory, outputDirectory: output }
}

async function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${name}=${JSON.stringify(value)}\n`)
  }
}

async function main() {
  const result = await qualifyDomainContracts({
    root: process.env.INPUT_ROOT || process.cwd(),
    repository: process.env.INPUT_REPOSITORY || process.env.GITHUB_REPOSITORY || '',
    selection: process.env.INPUT_SELECTION || 'all',
    before: process.env.INPUT_BEFORE || '',
    outputDirectory: process.env.INPUT_OUTPUT_DIRECTORY || undefined,
  })
  await writeOutput('plan', result.plan)
  await writeOutput('dirs', result.plan.selectedDirectories.join(' '))
  await writeOutput('has-selected', result.plan.selected.length > 0)
  await writeOutput('tarballs', result.tarballs)
  console.log(`Qualified ${result.plan.selected.length} Domain contract package(s)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`::error title=Domain contract qualification failed::${error.message}`)
    process.exitCode = 1
  })
}
