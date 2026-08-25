import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function tar(args) {
  return execFileSync('tar', args, { encoding: 'utf8' })
}

/** Verify package identity without deciding how a Domain represents or builds its public API. */
export function inspectDomainTarball(tarball, expected = {}) {
  const absolute = resolve(tarball)
  const files = tar(['-tzf', absolute])
    .split('\n')
    .filter((path) => path && !path.endsWith('/'))
    .sort()
  if (!files.includes('package/package.json')) {
    throw new Error('Domain tarball has no package.json')
  }
  const manifest = JSON.parse(tar(['-xOf', absolute, 'package/package.json']))
  if (expected.name && manifest.name !== expected.name) {
    throw new Error(`Packed package name is ${manifest.name}; expected ${expected.name}`)
  }
  if (expected.version && manifest.version !== expected.version) {
    throw new Error(`Packed package version is ${manifest.version}; expected ${expected.version}`)
  }
  return { files, manifest }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , tarball, name, version] = process.argv
    if (!tarball) throw new Error('Usage: tarball.mjs <tarball> [name] [version]')
    const result = inspectDomainTarball(tarball, { name, version })
    console.log(
      `Domain tarball verified: ${result.manifest.name}@${result.manifest.version} (${result.files.length} files)`,
    )
  } catch (error) {
    console.error(`::error title=Invalid Domain tarball::${error.message}`)
    process.exitCode = 1
  }
}
