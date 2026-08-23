import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_REGISTRY = 'https://jsr.io'

export function versionMetadataUrl(name, version, registry = DEFAULT_REGISTRY) {
  const match = /^@([^/]+)\/([^/]+)$/.exec(name)
  if (!match) {
    throw new Error(`Invalid JSR package name: ${name}`)
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('The JSR package version must be a non-empty string')
  }

  const [, scope, packageName] = match
  const base = registry.replace(/\/+$/, '')
  return `${base}/@${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}_meta.json`
}

export async function publishedStatus({
  name,
  version,
  registry = DEFAULT_REGISTRY,
  fetchImpl = fetch,
}) {
  const url = versionMetadataUrl(name, version, registry)
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'astrale-config-jsr-publish/1; https://github.com/astrale-os/config',
    },
  })

  if (response.status === 200) return 'published'
  if (response.status === 404) return 'absent'

  throw new Error(`JSR version lookup failed with HTTP ${response.status}: ${url}`)
}

export async function checkPackage(packageDirectory = '.', options = {}) {
  const configPath = resolve(packageDirectory, 'jsr.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  return publishedStatus({ ...options, name: config.name, version: config.version })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const status = await checkPackage(process.cwd(), {
      registry: process.env.JSR_REGISTRY_URL || DEFAULT_REGISTRY,
    })
    const { name, version } = JSON.parse(await readFile('jsr.json', 'utf8'))

    if (status === 'published') {
      console.log(`JSR: skip ${name}@${version} (already published)`)
      process.exitCode = 0
    } else {
      console.log(`JSR: ${name}@${version} is not published yet`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`::error title=JSR version check failed::${error.message}`)
    process.exitCode = 2
  }
}
