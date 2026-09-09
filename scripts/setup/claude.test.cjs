const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-readiness-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const scripts = path.join(root, 'scripts/setup')
  fs.cpSync(__dirname, scripts, { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), 'tools/\nnode_modules/\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"packageManager":"pnpm@12.3.1"}')
  fs.writeFileSync(path.join(root, '.nvmrc'), '26.7.0\n')
  fs.mkdirSync(path.join(root, 'domain'))
  fs.writeFileSync(path.join(root, 'domain/package.json'), '{"packageManager":"pnpm@12.1.0"}')
  assert.equal(spawnSync('git', ['init', root]).status, 0)
  const storage = path.join(root, 'tools')
  fs.mkdirSync(storage)
  fs.writeFileSync(
    path.join(scripts, 'setup.sh'),
    '#!/bin/bash\nset -eu\necho setup >> "$AGENT_SETUP_HOME/calls"\necho "export FIXTURE=1" > "$AGENT_SETUP_HOME/env.sh"\n',
  )
  fs.writeFileSync(
    path.join(scripts, 'verify.sh'),
    '#!/bin/bash\necho verify >> "$AGENT_SETUP_HOME/calls"\n[[ "${FAIL_VERIFY:-0}" == 0 ]]\n',
  )
  const run = (env = {}) =>
    spawnSync('bash', [path.join(scripts, 'claude_session_start.sh')], {
      env: {
        ...process.env,
        AGENT_SETUP_HOME: storage,
        CLAUDE_CODE_REMOTE: 'true',
        CLAUDE_ENV_FILE: '',
        AGENT_SETUP_BROWSER: '0',
        AGENT_SETUP_ASTRALE_CLI: '0',
        ...env,
      },
      encoding: 'utf8',
    })
  const count = () =>
    fs.readFileSync(path.join(storage, 'calls'), 'utf8').split('setup\n').length - 1
  const marker = () =>
    path.join(
      storage,
      'state/claude',
      fs.readdirSync(path.join(storage, 'state/claude')).find((n) => n.endsWith('.ready')),
    )
  const ok = (r) => assert.equal(r.status, 0, r.stderr)
  return { root, scripts, storage, run, count, marker, ok }
}

const linux = { skip: process.platform !== 'linux' }
test(
  'Claude reuses unchanged inputs but refreshes root and nested package pins, config and setup scripts',
  linux,
  (t) => {
    const f = fixture(t)
    f.ok(f.run())
    assert.equal(f.count(), 1)
    fs.writeFileSync(path.join(f.root, 'source.ts'), '// ordinary source edit')
    f.ok(f.run())
    assert.equal(f.count(), 1)
    for (const file of [
      'package.json',
      'domain/package.json',
      '.nvmrc',
      'pnpm-lock.yaml',
      'domain/.npmrc',
      'scripts/setup/setup.sh',
    ]) {
      fs.appendFileSync(path.join(f.root, file), '\n')
      f.ok(f.run())
    }
    assert.equal(f.count(), 7)
    f.ok(f.run())
    assert.equal(f.count(), 7)
  },
)
test('Claude upgrades legacy markers and repairs a missing environment file', linux, (t) => {
  const f = fixture(t)
  f.ok(f.run())
  fs.writeFileSync(f.marker(), 'ready\n')
  f.ok(f.run())
  assert.equal(f.count(), 2)
  assert.match(fs.readFileSync(f.marker(), 'utf8'), /^[a-f0-9]{64}\n$/)
  fs.rmSync(path.join(f.storage, 'env.sh'))
  f.ok(f.run())
  assert.equal(f.count(), 3)
})
test('failed refresh invalidates old success even when inputs are reverted', linux, (t) => {
  const f = fixture(t)
  f.ok(f.run())
  const marker = f.marker()
  const file = path.join(f.root, 'package.json'),
    original = fs.readFileSync(file)
  fs.appendFileSync(file, '\n')
  assert.notEqual(f.run({ FAIL_VERIFY: '1' }).status, 0)
  assert.equal(fs.existsSync(marker), false)
  fs.writeFileSync(file, original)
  f.ok(f.run())
  assert.equal(f.count(), 3)
})
