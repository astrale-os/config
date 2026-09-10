const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

function probe(t, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron readiness '))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const electron = path.join(root, 'desktop/node_modules/electron')
  fs.mkdirSync(path.join(electron, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'desktop/package.json'), '{}')
  fs.writeFileSync(path.join(electron, 'package.json'), '{"name":"electron","version":"43.1.1"}')
  fs.writeFileSync(path.join(electron, 'path.txt'), 'electron\n')
  fs.writeFileSync(path.join(electron, 'dist/electron'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return spawnSync(process.execPath, [path.join(__dirname, '../lib/electron.cjs')], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_REPO_ROOT: root },
  })
}

test('an executable Electron file with missing libraries is not ready', (t) => {
  const result = probe(t, 'echo "libgtk-3.so.0: cannot open shared object file" >&2; exit 127')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Electron cannot run.*\n.*libgtk-3/s)
})
test('Electron readiness requires the installed version to run', (t) => {
  const result = probe(t, 'echo v43.1.1')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Electron executable ready/)
})
test('an Electron executable with a different version fails verification', (t) => {
  const result = probe(t, 'echo v42.0.0')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /version mismatch/)
})
