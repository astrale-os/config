import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function tar(args) {
  return execFileSync('tar', args, { encoding: 'utf8' })
}

const ROOT_DOCUMENT =
  /^package\/(?:package\.json|README(?:\.[^/]+)?|LICEN[CS]E(?:\.[^/]+)?|NOTICE(?:\.[^/]+)?)$/iu
const CONTRACT_FILE = /^package\/dist\/schema\/.+\.(?:js|d\.ts)$/u

export function inspectContractTarball(tarball, expected = {}) {
  const absolute = resolve(tarball)
  const files = tar(['-tzf', absolute])
    .split('\n')
    .filter((path) => path && !path.endsWith('/'))
    .sort()
  if (files.some((path) => path.endsWith('.map'))) {
    throw new Error('Contract tarball contains source maps')
  }
  const unexpected = files.filter((path) => !ROOT_DOCUMENT.test(path) && !CONTRACT_FILE.test(path))
  if (unexpected.length > 0) {
    throw new Error(`Contract tarball contains non-contract files:\n- ${unexpected.join('\n- ')}`)
  }
  const javascript = files.filter((path) => path.endsWith('.js'))
  const declarations = files.filter((path) => path.endsWith('.d.ts'))
  if (javascript.length === 0 || declarations.length === 0) {
    throw new Error('Contract tarball must contain emitted Schema JavaScript and declarations')
  }

  const manifest = JSON.parse(tar(['-xOf', absolute, 'package/package.json']))
  if (expected.name && manifest.name !== expected.name) {
    throw new Error(`Packed package name is ${manifest.name}; expected ${expected.name}`)
  }
  if (expected.version && manifest.version !== expected.version) {
    throw new Error(`Packed package version is ${manifest.version}; expected ${expected.version}`)
  }
  const expectedExports = {
    '.': {
      types: './dist/schema/index.d.ts',
      import: './dist/schema/index.js',
    },
    './package.json': './package.json',
  }
  if (JSON.stringify(manifest.exports) !== JSON.stringify(expectedExports)) {
    throw new Error(
      `Packed exports must contain only the contract root and package metadata; found ${JSON.stringify(manifest.exports)}`,
    )
  }
  if (manifest.main !== './dist/schema/index.js' || manifest.types !== './dist/schema/index.d.ts') {
    throw new Error('Packed main/types do not resolve to dist/schema/index')
  }
  for (const target of ['./dist/schema/index.js', './dist/schema/index.d.ts']) {
    if (!files.includes(`package/${target.slice(2)}`)) {
      throw new Error(`Packed export target is missing: ${target}`)
    }
  }
  return { files, manifest, javascript, declarations }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , tarball, name, version] = process.argv
    if (!tarball) throw new Error('Usage: tarball.mjs <tarball> [name] [version]')
    const result = inspectContractTarball(tarball, { name, version })
    console.log(
      `Contract tarball verified: ${result.manifest.name}@${result.manifest.version} (${result.files.length} files)`,
    )
  } catch (error) {
    console.error(`::error title=Invalid Domain contract tarball::${error.message}`)
    process.exitCode = 1
  }
}
