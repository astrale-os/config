// Requiring Electron can download its binary. Only setup may take that path.
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const desktop = createRequire(path.resolve(process.env.AGENT_REPO_ROOT, 'desktop/package.json'))
const directory = path.dirname(desktop.resolve('electron/package.json'))
if (process.argv[2] === '--prepare') desktop('electron')
else if (process.argv.length !== 2) throw new Error('Usage: electron.cjs [--prepare]')

const relative = fs.readFileSync(path.join(directory, 'path.txt'), 'utf8').trim()
if (!relative) throw new Error('Electron binary path is missing; run setup')
const executable = path.resolve(
  process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(directory, 'dist'),
  relative,
)
fs.accessSync(executable, fs.constants.X_OK)
console.log(`Electron executable ready: ${executable}`)
