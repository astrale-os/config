// Only preparation may require Electron, which can download its binary.
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

const desktop = createRequire(path.resolve(process.env.AGENT_REPO_ROOT, 'desktop/package.json'))
const directory = path.dirname(desktop.resolve('electron/package.json'))
const mode = process.argv[2]
if (mode === '--prepare') desktop('electron')
else if (mode && mode !== '--executable')
  throw new Error('Usage: electron.cjs [--prepare|--executable]')

const relative = fs.readFileSync(path.join(directory, 'path.txt'), 'utf8').trim()
if (!relative) throw new Error('Electron binary path is missing; run setup')
const executable = path.resolve(
  process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(directory, 'dist'),
  relative,
)
fs.accessSync(executable, fs.constants.X_OK)
if (mode === '--executable') {
  console.log(executable)
} else {
  // --version exercises the dynamic loader without requiring a display or an app build.
  const args = process.getuid?.() === 0 ? ['--no-sandbox', '--version'] : ['--version']
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30_000 })
  if (result.error || result.status !== 0)
    throw new Error(`Electron cannot run: ${result.error?.message ?? ''}\n${result.stderr ?? ''}`)
  const expected = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version
  if (result.stdout.trim() !== `v${expected}`)
    throw new Error(`Electron version mismatch: expected ${expected}, got ${result.stdout.trim()}`)
  console.log(`Electron executable ready: ${executable} (${result.stdout.trim()})`)
}
