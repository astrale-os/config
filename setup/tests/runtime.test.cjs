const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const packageRoot = path.resolve(__dirname, '..')

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'setup runtime ')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'scripts/setup'), { recursive: true })
  fs.mkdirSync(path.join(root, 'home'))
  fs.writeFileSync(
    path.join(root, 'scripts/setup/repo.sh'),
    'export AGENT_SETUP_PROFILE=sdk AGENT_SETUP_BROWSER=0 AGENT_SETUP_ASTRALE_CLI=0\n',
  )
  fs.writeFileSync(path.join(root, '.nvmrc'), '26.7.0\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"packageManager":"pnpm@12.1.0"}')
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0)
  const env = {
    ...process.env,
    HOME: path.join(root, 'home'),
    AGENT_REPO_ROOT: root,
    AGENT_SETUP_HOME: path.join(root, 'storage'),
    AGENT_SETUP_TOOLS: 'check',
    PACKAGE_ROOT: packageRoot,
  }
  return {
    root,
    env,
    shell: (body) =>
      spawnSync(
        'bash',
        [
          '-c',
          'set -euo pipefail; source "$PACKAGE_ROOT/lib/common.sh"; agent_load_config; ' + body,
        ],
        { env, encoding: 'utf8', cwd: '/' },
      ),
  }
}

test('package paths and repository paths stay separate outside the checkout', (t) => {
  const f = fixture(t)
  const result = f.shell(
    'agent_check_repo; printf "%s\\n%s\\n" "$AGENT_REPO_ROOT" "$AGENT_SETUP_DIR"',
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `${f.root}\n${fs.realpathSync(packageRoot)}\n`)
})

test('fingerprint changes for manifests and pins but not ordinary source edits', (t) => {
  const f = fixture(t)
  const fingerprint = () => {
    const result = f.shell('agent_setup_fingerprint')
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  const original = fingerprint()
  fs.writeFileSync(path.join(f.root, 'source.ts'), 'export const value = 1')
  assert.equal(fingerprint(), original)
  fs.writeFileSync(path.join(f.root, '.bun-version'), '1.4.0\n')
  assert.notEqual(fingerprint(), original)
})

test('check policy cannot install tools or write profiles', (t) => {
  const f = fixture(t)
  const result = f.shell('agent_persist_environment; agent_npm_install /tmp/unused bun')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Tool installation disabled/)
  assert.deepEqual(fs.readdirSync(f.env.HOME), [])
})

test('pinned Bun fails locally instead of downloading another version', (t) => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, '.bun-version'), '0.0.1\n')
  const result = f.shell('agent_ensure_bun')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Activate Bun 0.0.1/)
})

test('Claude prepares once, refreshes changed inputs and never caches a failure', (t) => {
  if (spawnSync('sh', ['-c', 'command -v flock']).status !== 0)
    return t.skip('Requires Linux flock')
  const f = fixture(t)
  f.env.CLAUDE_CODE_REMOTE = 'true'
  f.env.AGENT_SETUP_TOOLS = 'install'
  const body = `
    source "$PACKAGE_ROOT/lib/claude.sh"
    agent_prepare() {
      printf 'prepare\\n' >> "$AGENT_REPO_ROOT/calls"
      [[ ! -f "$AGENT_REPO_ROOT/fail" ]] || return 1
      mkdir -p "$(dirname "$AGENT_ENV_FILE")"
      printf '# prepared\\n' > "$AGENT_ENV_FILE"
    }
    agent_claude
  `
  assert.equal(f.shell(body).status, 0)
  assert.equal(f.shell(body).status, 0)
  assert.equal(fs.readFileSync(path.join(f.root, 'calls'), 'utf8'), 'prepare\n')
  fs.writeFileSync(path.join(f.root, '.bun-version'), '1.4.0\n')
  fs.writeFileSync(path.join(f.root, 'fail'), '')
  assert.notEqual(f.shell(body).status, 0)
  const state = path.join(f.env.AGENT_SETUP_HOME, 'state/claude')
  assert.equal(
    fs.readdirSync(state).some((name) => name.endsWith('.ready')),
    false,
  )
  fs.unlinkSync(path.join(f.root, 'fail'))
  assert.equal(f.shell(body).status, 0)
  assert.equal(fs.readFileSync(path.join(f.root, 'calls'), 'utf8'), 'prepare\nprepare\nprepare\n')
})

test('Config profile accepts its own tree and rejects missing ox or extra tools', (t) => {
  const f = fixture(t)
  fs.writeFileSync(
    path.join(f.root, 'scripts/setup/repo.sh'),
    'export AGENT_SETUP_PROFILE=config AGENT_SETUP_BROWSER=0 AGENT_SETUP_ASTRALE_CLI=0\n',
  )
  fs.writeFileSync(path.join(f.root, 'pnpm-workspace.yaml'), "packages: ['packages/*']\n")
  fs.mkdirSync(path.join(f.root, 'packages/ox'), { recursive: true })
  fs.writeFileSync(path.join(f.root, 'packages/ox/package.json'), '{}')
  const check = 'source "$PACKAGE_ROOT/profiles/config.sh"; repo_preflight'
  assert.equal(f.shell(check).status, 0)
  assert.match(f.shell('AGENT_SETUP_BROWSER=1; ' + check).stderr, /neither global browsers/)
  fs.unlinkSync(path.join(f.root, 'packages/ox/package.json'))
  assert.match(f.shell(check).stderr, /Missing local ox/)
})
