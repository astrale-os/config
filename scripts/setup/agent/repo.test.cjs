const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'config setup-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const scripts = path.join(root, 'scripts/setup/agent')
  fs.cpSync(__dirname, scripts, { recursive: true })
  fs.writeFileSync(path.join(root, '.nvmrc'), process.versions.node + '\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"packageManager":"pnpm@12.1.0"}')
  const home = path.join(root, 'home')
  const storage = path.join(root, 'tools')
  const bin = path.join(storage, 'bin')
  fs.mkdirSync(home)
  fs.mkdirSync(bin, { recursive: true })
  const env = {
    ...process.env,
    // pnpm injects a module-resolution fallback to its own dependencies.
    // Fixtures must resolve only their own packages, including missing-package checks.
    NODE_OPTIONS: '',
    NODE_PATH: '',
    HOME: home,
    AGENT_SETUP_HOME: storage,
    AGENT_HARNESSES: 'codex,claude',
    AGENT_SETUP_BROWSER: '',
    AGENT_SETUP_ASTRALE_CLI: '',
    CLAUDE_ENV_FILE: '',
    CLAUDE_CODE_REMOTE: '',
    TEST_LOG: path.join(root, 'calls'),
  }
  function run(script, args = [], extra = {}) {
    return spawnSync('bash', [path.join(scripts, script), ...args], {
      cwd: os.tmpdir(),
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 15_000,
    })
  }
  function executable(name, body) {
    fs.writeFileSync(
      path.join(bin, name),
      '#!/usr/bin/env bash\nset -euo pipefail\n' + body + '\n',
      { mode: 0o755 },
    )
  }
  function mock(body) {
    fs.appendFileSync(path.join(scripts, 'lib/common.sh'), '\n' + body)
  }
  assert.equal(spawnSync('git', ['init', '--initial-branch=feature', root]).status, 0)
  return { root, scripts, storage, env, run, executable, mock }
}
function success(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
}

test('Config preflight works before runtimes exist and rejects invalid options without installing', (t) => {
  const f = fixture(t)
  for (const name of ['node', 'pnpm', 'bun', 'npm'])
    f.executable(name, 'echo unexpected >> "$TEST_LOG"; exit 99')
  success(f.run('setup_repo.sh', ['--check']))
  const invalid = f.run('setup.sh', [], { AGENT_SETUP_BROWSER: 'invalid' })
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /AGENT_SETUP_BROWSER must be 0 or 1/)
  assert.equal(fs.existsSync(f.env.TEST_LOG), false)
  assert.equal(fs.existsSync(path.join(f.storage, 'env.sh')), false)
})

test('Config defaults prepare dependencies on each call without browser or Astrale work', (t) => {
  const f = fixture(t)
  f.mock(`
agent_ensure_node() { echo node >> "$TEST_LOG"; }
agent_ensure_bun() { echo bun >> "$TEST_LOG"; }
agent_install_repo() { echo dependencies >> "$TEST_LOG"; cd "$AGENT_REPO_ROOT"; }
agent_select_browser() { echo unexpected-browser >> "$TEST_LOG"; exit 99; }
agent_ensure_skill() { echo unexpected-skill >> "$TEST_LOG"; exit 99; }
`)
  f.executable('astrale', 'echo unexpected-astrale >> "$TEST_LOG"; exit 99')
  success(f.run('setup_repo.sh'))
  success(f.run('setup_repo.sh'))
  assert.equal(
    fs.readFileSync(f.env.TEST_LOG, 'utf8'),
    'node\nbun\ndependencies\nnode\nbun\ndependencies\n',
  )
  assert.ok(fs.existsSync(path.join(f.storage, 'env.sh')))
})

test('Config honors explicit browser and Astrale opt-ins for both agents', (t) => {
  const f = fixture(t)
  f.mock(`
agent_ensure_node() { :; }
agent_ensure_bun() { :; }
agent_install_repo() { :; }
agent_select_browser() { echo browser >> "$TEST_LOG"; }
agent_ensure_skill() { printf '%s:%s\\n' "$1" "$3" >> "$TEST_LOG"; }
`)
  f.executable('astrale', 'echo fixture-version')
  success(f.run('setup_repo.sh', [], { AGENT_SETUP_BROWSER: '1', AGENT_SETUP_ASTRALE_CLI: '1' }))
  assert.equal(
    fs.readFileSync(f.env.TEST_LOG, 'utf8'),
    'codex:astrale-cli\ncodex:astrale-domain\nclaude:astrale-cli\nclaude:astrale-domain\nbrowser\n',
  )
})

test('Config verification requires its local ox exports, with no Domains package dependency', (t) => {
  const f = fixture(t)
  f.executable(
    'pnpm',
    'case "$*" in --version) echo 12.1.0 ;; "exec oxlint --version"|"exec oxfmt --version"|"exec tsc --version") echo fixture-version ;; *) exit 99 ;; esac',
  )
  f.executable('bun', 'echo fixture-version')
  const ox = path.join(f.root, 'node_modules/@astrale-os/ox')
  fs.mkdirSync(ox, { recursive: true })
  fs.writeFileSync(path.join(f.root, 'node_modules/.modules.yaml'), 'fixture')
  fs.writeFileSync(
    path.join(ox, 'package.json'),
    JSON.stringify({ type: 'module', exports: { './fmt': './fmt.js', './lint': './lint.js' } }),
  )
  for (const name of ['fmt', 'lint'])
    fs.writeFileSync(path.join(ox, `${name}.js`), 'export default {}')
  success(f.run('verify.sh'))
  fs.rmSync(path.join(ox, 'lint.js'))
  const missing = f.run('verify.sh')
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/)
})

test('the configured Claude hook only loads paths locally', (t) => {
  const f = fixture(t)
  const settings = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../.claude/settings.json'), 'utf8'),
  )
  const command = settings.hooks.SessionStart[0].hooks[0].command
  const envFile = path.join(f.root, 'claude.env')
  fs.writeFileSync(path.join(f.storage, 'env.sh'), 'export CONFIG_SETUP_TEST=ready\n')
  const result = spawnSync('bash', ['-c', command], {
    env: {
      ...f.env,
      CLAUDE_PROJECT_DIR: f.root,
      CLAUDE_ENV_FILE: envFile,
      CLAUDE_CODE_REMOTE: 'false',
    },
    encoding: 'utf8',
  })
  success(result)
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'export CONFIG_SETUP_TEST=ready\n')
  assert.equal(fs.existsSync(f.env.TEST_LOG), false)
})
