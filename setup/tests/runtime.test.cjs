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

test('CLI preflight rejects an invalid Bun pin or an incomplete checkout before preparation', (t) => {
  const f = fixture(t)
  fs.writeFileSync(
    path.join(f.root, 'scripts/setup/repo.sh'),
    'export AGENT_SETUP_PROFILE=cli AGENT_SETUP_BROWSER=0 AGENT_SETUP_ASTRALE_CLI=0\n',
  )
  for (const name of [
    'pnpm-workspace.yaml',
    'studio/package.json',
    'studio/e2e/fixture/package.json',
    'studio/e2e/fixture/peer/package.json',
    'scripts/build-embedded-assets.ts',
  ]) {
    fs.mkdirSync(path.dirname(path.join(f.root, name)), { recursive: true })
    fs.writeFileSync(path.join(f.root, name), '{}')
  }
  fs.writeFileSync(path.join(f.root, '.bun-version'), '1.4.0\n')
  const check = 'source "$PACKAGE_ROOT/profiles/cli.sh"; repo_preflight'
  assert.equal(f.shell(check).status, 0)
  fs.writeFileSync(path.join(f.root, '.bun-version'), 'latest\n')
  assert.match(f.shell(check).stderr, /exact Bun version/)
  fs.writeFileSync(path.join(f.root, '.bun-version'), '1.4.0\n')
  fs.unlinkSync(path.join(f.root, 'studio/package.json'))
  assert.match(f.shell(check).stderr, /Incomplete CLI checkout/)
})

test('CLI verification never regenerates missing or stale assets', (t) => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.root, 'studio/node_modules'), { recursive: true })
  const check = `cd "$AGENT_REPO_ROOT"; source "$PACKAGE_ROOT/profiles/cli.sh";
    pnpm() { :; }
    bun() { printf '%s\\n' "$*" >> "$AGENT_REPO_ROOT/bun-calls"; return 42; }
    repo_verify`
  assert.match(f.shell(check).stderr, /Embedded assets are missing/)
  assert.equal(fs.existsSync(path.join(f.root, 'bun-calls')), false)
  for (const name of [
    'src/generated/embedded-assets.ts',
    'viewer/dist/index.html',
    'studio/client/dist/index.html',
  ]) {
    fs.mkdirSync(path.dirname(path.join(f.root, name)), { recursive: true })
    fs.writeFileSync(path.join(f.root, name), 'fixture')
  }
  assert.equal(f.shell(check).status, 42)
  const calls = fs.readFileSync(path.join(f.root, 'bun-calls'), 'utf8')
  assert.match(calls, /embeddedAssetCacheIsCurrent/)
  assert.doesNotMatch(calls, /bin\/astrale.ts|bin\/run.ts|assets:ensure/)
})

test('Astrale local policy rejects a missing CLI without installing it', (t) => {
  const f = fixture(t)
  const result = f.shell(
    'source "$PACKAGE_ROOT/lib/astrale.sh"; AGENT_SETUP_ASTRALE_CLI=1; astrale() { return 1; }; node() { echo unexpected-install; }; agent_prepare_astrale',
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Install the published Astrale CLI locally/)
  assert.doesNotMatch(result.stdout, /unexpected-install/)
})

test('Astrale installation reuses a working executable without downloading', (t) => {
  const f = fixture(t)
  const bin = path.join(f.root, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'astrale'), '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 })
  const result = f.shell(
    'source "$PACKAGE_ROOT/lib/astrale.sh"; export PATH="$AGENT_REPO_ROOT/bin:$PATH"; AGENT_SETUP_ASTRALE_CLI=1; AGENT_SETUP_TOOLS=install; node() { echo unexpected-install; return 99; }; agent_prepare_astrale',
  )
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /unexpected-install/)
})

test('Admin preflight checks all package manifests without executing package tools', (t) => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, 'pnpm-workspace.yaml'), 'packages: []')
  for (const name of [
    'auth',
    'registry',
    'router',
    'console',
    'console/web',
    'invitation',
    'test',
    'test/web',
    'domain',
    'worker',
  ]) {
    fs.mkdirSync(path.join(f.root, name), { recursive: true })
    fs.writeFileSync(path.join(f.root, name, 'package.json'), '{}')
  }
  const check = 'source "$PACKAGE_ROOT/profiles/admin.sh"; repo_preflight'
  assert.equal(f.shell(check).status, 0)
  fs.unlinkSync(path.join(f.root, 'test/web/package.json'))
  assert.match(f.shell(check).stderr, /missing test\/web\/package.json/)
})
