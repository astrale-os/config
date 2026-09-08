const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

test('shared-source synchronization preserves consumer choices, integrations and repository setup', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent setup sync-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}')
  const target = path.join(root, 'scripts/agent_setup')
  fs.mkdirSync(target, { recursive: true })
  const owned = [
    'repo.config.sh',
    'setup_repo.sh',
    'claude_session_start.sh',
    'verify.sh',
    'README.md',
  ]
  for (const file of owned) fs.writeFileSync(path.join(target, file), `consumer-owned ${file}\n`)
  const sync = (...args) =>
    spawnSync('bash', [path.join(__dirname, 'sync.sh'), ...args, root], { encoding: 'utf8' })
  const copied = sync()
  assert.equal(copied.status, 0, copied.stderr)
  for (const file of owned)
    assert.equal(fs.readFileSync(path.join(target, file), 'utf8'), `consumer-owned ${file}\n`)
  for (const file of [
    'setup.sh',
    'setup_runtimes.sh',
    'setup_browser_tools.sh',
    'setup_skills.sh',
    'lib/common.sh',
  ]) {
    assert.equal(
      fs.readFileSync(path.join(target, file), 'utf8'),
      fs.readFileSync(path.join(__dirname, file), 'utf8'),
    )
  }
  assert.equal(sync('--check').status, 0)
  fs.appendFileSync(path.join(target, 'setup.sh'), '\n# drift\n')
  const drift = sync('--check')
  assert.notEqual(drift.status, 0)
  assert.match(drift.stderr, /Out of sync/)
  assert.match(
    fs.readFileSync(path.join(target, 'setup.sh'), 'utf8'),
    /# drift/,
    '--check must not mutate a consumer',
  )
})
