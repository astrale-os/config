import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PUBLISHED_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

export function validatePublishOrder(packages) {
  const positions = new Map()

  for (const [index, pkg] of packages.entries()) {
    const name = pkg.manifest.name
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`Missing package name in ${pkg.dir}`)
    }
    if (positions.has(name)) {
      throw new Error(`Duplicate package ${name} in the publish set`)
    }
    positions.set(name, index)
  }

  const violations = []
  for (const [consumerIndex, consumer] of packages.entries()) {
    for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
      for (const producerName of Object.keys(consumer.manifest[field] ?? {})) {
        const producerIndex = positions.get(producerName)
        if (producerIndex !== undefined && producerIndex > consumerIndex) {
          violations.push(
            `${consumer.manifest.name} (${consumer.dir}) depends on later package ${producerName} through ${field}`,
          )
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Publish order is not producer-first:\n- ${violations.join('\n- ')}`)
  }
}

export async function loadPublishSet(dirs, cwd = process.cwd()) {
  return Promise.all(
    dirs.map(async (dir) => ({
      dir,
      manifest: JSON.parse(await readFile(resolve(cwd, dir, 'package.json'), 'utf8')),
    })),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const dirs = process.argv.slice(2)
    if (dirs.length === 0) throw new Error('No package directories supplied')
    validatePublishOrder(await loadPublishSet(dirs))
    console.log(`Publish order validated: ${dirs.join(' -> ')}`)
  } catch (error) {
    console.error(`::error title=Invalid publish order::${error.message}`)
    process.exitCode = 1
  }
}
