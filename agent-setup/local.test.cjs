const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-setup-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const scripts = path.join(root, 'scripts/setup'),
    bin = path.join(root, 'bin'),
    home = path.join(root, 'home')
  fs.cpSync(__dirname, scripts, { recursive: true })
  fs.mkdirSync(bin)
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(root, '.nvmrc'), '26.7.0\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"packageManager":"pnpm@12.1.0"}')
  fs.writeFileSync(
    path.join(scripts, 'repo.config.sh'),
    'export AGENT_SETUP_BROWSER=0 AGENT_SETUP_ASTRALE_CLI=0\n',
  )
  fs.writeFileSync(
    path.join(scripts, 'setup_repo.sh'),
    'set -euo pipefail\nsource "$(dirname "$0")/lib/common.sh"\nagent_check_repo\n[[ "${1:-}" != --check ]] || exit 0\nagent_ensure_node\nagent_ensure_bun\nagent_install_repo\nagent_persist_environment\n',
  )
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env.PATH}`,
    AGENT_SETUP_TOOLS: 'check',
    AGENT_SETUP_HOME: path.join(home, 'managed'),
    AGENT_HARNESSES: 'claude,codex',
    TEST_LOG: path.join(root, 'calls'),
    CLAUDE_ENV_FILE: '',
    BASH_ENV: '',
  }
  const stub = (name, body) =>
    fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nset -eu\n' + body + '\n', { mode: 0o755 })
  stub('node', 'if [[ "$*" == --version ]]; then echo v26.7.0; else echo 12.1.0; fi')
  stub('bun', 'echo 1.4.0')
  stub(
    'pnpm',
    'if [[ "$*" == --version ]]; then echo 12.1.0; else echo "pnpm:$*" >> "$TEST_LOG"; fi',
  )
  for (const name of ['npm', 'curl', 'skills', 'apt-get'])
    stub(name, 'echo forbidden >> "$TEST_LOG"; exit 92')
  const git = (args) => spawnSync('git', args, { cwd: root, env, encoding: 'utf8' })
  assert.equal(git(['init', '-b', 'feature']).status, 0)
  assert.equal(
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ]).status,
    0,
  )
  const run = (extra) =>
    spawnSync('bash', [path.join(scripts, 'setup.sh')], {
      cwd: root,
      env: { ...env, ...extra },
      encoding: 'utf8',
    })
  return { root, home, env, stub, run, git }
}
test('local setup prepares dependencies repeatedly without writing global tools, skills or profiles', (t) => {
  const f = fixture(t),
    head = f.git(['rev-parse', 'HEAD']).stdout
  for (let i = 0; i < 2; i++) {
    const r = f.run()
    assert.equal(r.status, 0, r.stderr)
  }
  assert.equal(
    fs.readFileSync(f.env.TEST_LOG, 'utf8'),
    'pnpm:install --no-frozen-lockfile --prefer-offline\npnpm:install --no-frozen-lockfile --prefer-offline\n',
  )
  assert.deepEqual(fs.readdirSync(f.home), [])
  assert.equal(f.git(['rev-parse', 'HEAD']).stdout, head)
  assert.equal(f.git(['branch', '--show-current']).stdout.trim(), 'feature')
})
for (const [tool, expected] of [
  ['node', /Activate Node/],
  ['bun', /Install Bun/],
  ['pnpm', /Activate pnpm/],
]) {
  test(`local setup rejects unavailable ${tool} before installing dependencies`, (t) => {
    const f = fixture(t)
    f.stub(tool, 'exit 1')
    const r = f.run()
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, expected)
    assert.equal(fs.existsSync(f.env.TEST_LOG), false)
    assert.deepEqual(fs.readdirSync(f.home), [])
  })
}
test('invalid installation mode fails before any preparation', (t) => {
  const f = fixture(t),
    r = f.run({ AGENT_SETUP_TOOLS: 'typo' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /must be check or install/)
  assert.equal(fs.existsSync(f.env.TEST_LOG), false)
})
