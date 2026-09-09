const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

function fixture(t) {
  // Spaces in paths exercise the same entry points used by standalone clones and worktrees.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'astrale setup test-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const scripts = path.join(root, 'scripts/setup')
  fs.cpSync(__dirname, scripts, { recursive: true })
  // Options belong to consumers, so a fresh consumer fixture supplies its own defaults.
  fs.writeFileSync(
    path.join(scripts, 'repo.config.sh'),
    'export AGENT_SETUP_BROWSER="${AGENT_SETUP_BROWSER:-1}"\n' +
      'export AGENT_SETUP_ASTRALE_CLI="${AGENT_SETUP_ASTRALE_CLI:-0}"\n',
  )
  const storage = path.join(root, 'tool storage')
  const bin = path.join(storage, 'bin')
  const home = path.join(root, 'home')
  fs.mkdirSync(bin, { recursive: true })
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(root, '.nvmrc'), '26.7.0\n')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@12.1.0' }),
  )
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '# reviewed fixture lock\n')
  const env = {
    ...process.env,
    HOME: home,
    AGENT_HARNESSES: '',
    AGENT_SETUP_BROWSER: '',
    AGENT_SETUP_ASTRALE_CLI: '',
    AGENT_SETUP_HOME: storage,
    FIXTURE_ROOT: root,
    TEST_LOG: path.join(root, 'calls.log'),
  }
  function shell(body, extra = {}) {
    return spawnSync(
      'bash',
      ['-c', 'set -euo pipefail\nsource "$FIXTURE_ROOT/scripts/setup/lib/common.sh"\n' + body],
      {
        cwd: os.tmpdir(),
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout: 15_000,
      },
    )
  }
  function executable(name, body, directory = bin) {
    fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, name)
    fs.writeFileSync(file, '#!/usr/bin/env bash\nset -euo pipefail\n' + body + '\n', {
      mode: 0o755,
    })
    return file
  }
  function mockCommon(body) {
    fs.appendFileSync(path.join(scripts, 'lib/common.sh'), '\n' + body + '\n')
  }
  return { root, scripts, storage, bin, home, env, shell, executable, mockCommon }
}

function success(result) {
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
}

function browserFixture(t) {
  const f = fixture(t)
  const cache = path.join(f.root, 'preinstalled browsers')
  const executable = f.executable('chrome', 'exit 0', cache)
  const module = path.join(f.root, 'preinstalled playwright')
  fs.mkdirSync(module)
  fs.writeFileSync(path.join(module, 'package.json'), '{"name":"playwright","main":"index.cjs"}')
  fs.writeFileSync(
    path.join(module, 'index.cjs'),
    `
const fs = require('node:fs');
const path = require('node:path');
exports.chromium = {
  executablePath: () => path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || ${JSON.stringify(cache)}, 'chrome'),
  launch: async () => {
    fs.appendFileSync(process.env.TEST_LOG, 'launch:' + exports.chromium.executablePath() + '\\n');
    if (process.env.TEST_BROWSER_FAILURE === 'sandbox') throw new Error('sandbox permission denied');
    if (process.env.TEST_BROWSER_FAILURE === 'libraries' && !fs.existsSync(path.join(process.env.FIXTURE_ROOT, 'libraries-ready')))
      throw new Error('error while loading shared libraries: libatk-1.0.so.0');
    return { newPage: async () => ({ setContent: async () => {}, title: async () => 'Astrale setup' }), close: async () => {} };
  }
};
`,
  )
  const cli = path.join(module, 'cli.cjs')
  fs.writeFileSync(
    cli,
    `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('Version 1.60.0'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(f.env.TEST_LOG)}, 'playwright:' + args.join(' ') + '\\n');
if (args[0] === 'install-deps') {
  for (const argv of [['update'], ['install', '-y', 'libatk1.0-0t64']]) {
    const result = spawnSync('apt-get', argv, { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
} else if (args[0] === 'install') {
  process.exit(process.env.TEST_DOWNLOAD_FAILURE ? 43 : 0);
} else process.exit(99);
`,
    { mode: 0o755 },
  )
  fs.symlinkSync(cli, path.join(f.bin, 'playwright'))
  for (const tool of ['agent-browser', 'chrome-devtools'])
    f.executable(tool, 'echo fixture-version')
  f.executable('npm', 'echo unexpected-npm >> "$TEST_LOG"; exit 99')
  f.mockCommon(`
agent_bootstrap_system() { :; }
agent_ensure_node() { :; }
agent_check_browser() {
  if [[ "$1" == playwright ]]; then
    node "$AGENT_SETUP_DIR/lib/browser-check.cjs" playwright
  else
    printf 'probe:%s\\n' "$1" >> "$TEST_LOG"
  fi
}
`)
  return { ...f, cache, browserExecutable: executable, playwrightModule: module }
}

for (const harness of ['claude', 'codex']) {
  test(`${harness} browser setup reuses the preinstalled pair and paths without downloads or APT`, (t) => {
    const f = browserFixture(t)
    f.executable('apt-get', 'echo unexpected-apt >> "$TEST_LOG"; exit 99')
    const env = { AGENT_HARNESSES: harness, PLAYWRIGHT_BROWSERS_PATH: f.cache }
    success(f.shell('bash "$FIXTURE_ROOT/scripts/setup/setup_browser_tools.sh"', env))
    const calls = fs.readFileSync(f.env.TEST_LOG, 'utf8')
    assert.equal(
      calls,
      `launch:${f.browserExecutable}\nprobe:agent-browser\nprobe:chrome-devtools\n`,
    )
    const restored = f.shell(
      'source "$AGENT_ENV_FILE"; printf "%s\\n" "$PLAYWRIGHT_BROWSERS_PATH" "$AGENT_BROWSER_EXECUTABLE_PATH" "$AGENT_PLAYWRIGHT_MODULE"; playwright --version',
    )
    success(restored)
    assert.equal(
      restored.stdout,
      `${f.cache}\n${f.browserExecutable}\n${f.playwrightModule}\nVersion 1.60.0\n`,
    )
  })
}

test('browser setup also preserves a working default Playwright cache when no path was supplied', (t) => {
  const f = browserFixture(t)
  success(
    f.shell(
      'unset PLAYWRIGHT_BROWSERS_PATH; bash "$FIXTURE_ROOT/scripts/setup/setup_browser_tools.sh"',
    ),
  )
  const restored = f.shell(
    'export PLAYWRIGHT_BROWSERS_PATH=/wrong; source "$AGENT_ENV_FILE"; test -z "${PLAYWRIGHT_BROWSERS_PATH+x}"; printf "%s" "$AGENT_BROWSER_EXECUTABLE_PATH"',
  )
  success(restored)
  assert.equal(restored.stdout, f.browserExecutable)
  assert.doesNotMatch(fs.readFileSync(f.env.TEST_LOG, 'utf8'), /playwright:|unexpected-/)
})

test('browser setup never treats sandbox errors as missing libraries and stops on a failed download', (t) => {
  const f = browserFixture(t)
  f.executable('apt-get', 'echo unexpected-apt >> "$TEST_LOG"; exit 99')
  const result = f.shell('bash "$FIXTURE_ROOT/scripts/setup/setup_browser_tools.sh"', {
    PLAYWRIGHT_BROWSERS_PATH: f.cache,
    TEST_BROWSER_FAILURE: 'sandbox',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /without missing system libraries/)
  assert.doesNotMatch(fs.readFileSync(f.env.TEST_LOG, 'utf8'), /unexpected-apt|install-deps|probe:/)
  fs.rmSync(f.browserExecutable)
  assert.equal(
    f.shell('bash "$FIXTURE_ROOT/scripts/setup/setup_browser_tools.sh"', {
      PLAYWRIGHT_BROWSERS_PATH: f.cache,
      TEST_DOWNLOAD_FAILURE: '1',
    }).status,
    43,
  )
  assert.equal(fs.existsSync(path.join(f.storage, 'env.sh')), false)
})

test(
  'Linux browser setup repairs libraries through the selected APT route and propagates APT failures',
  { skip: process.platform !== 'linux' },
  (t) => {
    for (const [host, failure] of [
      ['snapshot.ubuntu.com', ''],
      ['archive.ubuntu.com', ''],
      ['snapshot.ubuntu.com', 'signature'],
    ]) {
      const f = browserFixture(t)
      f.executable(
        'apt-get',
        `
# sudo intentionally strips fixture variables; bake these controlled test values into the stub.
TEST_LOG='${f.env.TEST_LOG}'
FIXTURE_ROOT='${f.root}'
TEST_APT_HOST='${host}'
TEST_APT_FAILURE='${failure}'
printf 'apt:%s:config=%s:proxy=%s\\n' "$*" "$APT_CONFIG" "$https_proxy" >> "$TEST_LOG"
if [[ "$*" == '--print-uris update' ]]; then
  printf "'https://%s/ubuntu/20260828T000000Z/dists/noble/InRelease' index 0\\n" "$TEST_APT_HOST"
elif [[ "$*" == *' update' && -n "$TEST_APT_FAILURE" ]]; then
  echo 'NO_PUBKEY fixture' >&2; exit 100
elif [[ "$*" == *' install '* ]]; then
  touch "$FIXTURE_ROOT/libraries-ready"
fi
`,
      )
      const result = f.shell('bash "$FIXTURE_ROOT/scripts/setup/setup_browser_tools.sh"', {
        PLAYWRIGHT_BROWSERS_PATH: f.cache,
        TEST_BROWSER_FAILURE: 'libraries',
        TEST_APT_HOST: host,
        TEST_APT_FAILURE: failure,
        APT_CONFIG: '/existing/proxy.conf',
        https_proxy: 'http://proxy.example:8080',
      })
      if (!failure) success(result)
      else assert.equal(result.status, 100, `${result.stdout}\n${result.stderr}`)
      const calls = fs.readFileSync(f.env.TEST_LOG, 'utf8')
      assert.match(calls, /config=\/existing\/proxy.conf:proxy=http:\/\/proxy.example:8080/)
      assert.equal(calls.includes('Dir::Etc::sourcelist='), host === 'snapshot.ubuntu.com')
      assert.equal(calls.match(/apt:--print-uris update/g)?.length, 1)
      assert.equal(calls.match(/playwright:install-deps chromium/g)?.length, 1)
      assert.doesNotMatch(calls, /playwright:install --force|unexpected-npm/)
      if (failure) {
        assert.equal(result.status, 100)
        assert.match(result.stdout, /NO_PUBKEY/)
        assert.doesNotMatch(calls, /probe:/)
        assert.equal(fs.existsSync(path.join(f.storage, 'env.sh')), false)
      } else {
        success(result)
        assert.equal(calls.match(/launch:/g)?.length, 2)
        assert.match(calls, /probe:chrome-devtools/)
      }
      // Every temporary source/index/wrapper directory must be removed on success and failure.
      for (const match of calls.matchAll(
        /Dir::Etc::sourcelist=(\/tmp\/astrale-browser-deps\.[^/]+)\//g,
      ))
        assert.equal(fs.existsSync(match[1]), false)
    }
  },
)

test('browser APT policy selects official sources only for active Ubuntu 24.04 snapshot URIs', (t) => {
  const f = fixture(t)
  const log = path.join(f.root, 'apt.log')
  const snapshot =
    "'https://snapshot.ubuntu.com/ubuntu/20260828T000000Z/dists/noble/InRelease' index 0"
  for (const [output, osId, version, allowed] of [
    [snapshot, 'ubuntu', '24.04', true],
    [snapshot.replace('https:', 'http:'), 'ubuntu', '24.04', true],
    [snapshot, 'ubuntu', '22.04', false],
    [snapshot, 'debian', '24.04', false],
    [snapshot.replace('snapshot.ubuntu.com', 'archive.ubuntu.com'), 'ubuntu', '24.04', false],
    [
      snapshot.replace('snapshot.ubuntu.com', 'snapshot.ubuntu.com.example'),
      'ubuntu',
      '24.04',
      false,
    ],
    ['# disabled snapshot.ubuntu.com', 'ubuntu', '24.04', false],
  ]) {
    fs.writeFileSync(log, output)
    const result = f.shell(
      `source "$FIXTURE_ROOT/scripts/setup/lib/browser.sh"; agent_browser_use_official_sources ${osId} ${version} "$FIXTURE_ROOT/apt.log"`,
    )
    assert.equal(result.status === 0, allowed, output)
  }
})

test('browser library routes only selected APT calls to signed Ubuntu sources', (t) => {
  const f = fixture(t)
  const apt = f.executable(
    'real-apt',
    'printf "%s\\n" "$@" >> "$TEST_LOG"; printf "APT_CONFIG=%s\\n" "${APT_CONFIG:-}" >> "$TEST_LOG"',
  )
  const script = 'source "$FIXTURE_ROOT/scripts/setup/lib/browser.sh"; '
  const env = { AGENT_BROWSER_APT_GET: apt, APT_CONFIG: '/existing/proxy.conf' }
  success(f.shell(script + 'agent_browser_apt_get install -y libatk1.0-0t64', env))
  const configured = fs.readFileSync(f.env.TEST_LOG, 'utf8')
  assert.match(configured, /APT::Update::Error-Mode=any/)
  assert.match(configured, /Acquire::https::Timeout=20/)
  assert.match(configured, /APT_CONFIG=\/existing\/proxy.conf/)
  assert.doesNotMatch(configured, /Dir::Etc::source/)
  for (const [architecture, host] of [
    ['amd64', 'archive.ubuntu.com/ubuntu'],
    ['arm64', 'ports.ubuntu.com/ubuntu-ports'],
  ]) {
    const sources = path.join(f.root, architecture)
    success(
      f.shell(
        script + `agent_browser_write_sources "$FIXTURE_ROOT/${architecture}" ${architecture}`,
      ),
    )
    const content = fs.readFileSync(path.join(sources, 'ubuntu.sources'), 'utf8')
    assert.ok(content.includes(`URIs: https://${host}`))
    assert.match(content, /Suites: noble noble-updates/)
    assert.match(content, /Suites: noble-security/)
    assert.match(content, /Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring.gpg/)
    assert.match(content, /Snapshot: no/)
    assert.doesNotMatch(content, /Trusted:|snapshot.ubuntu.com/)
    fs.writeFileSync(f.env.TEST_LOG, '')
    success(
      f.shell(script + 'agent_browser_apt_get install -y libatk1.0-0t64', {
        ...env,
        AGENT_BROWSER_APT_SOURCES: sources,
      }),
    )
    const fallback = fs.readFileSync(f.env.TEST_LOG, 'utf8')
    assert.ok(fallback.includes(`Dir::Etc::sourcelist=${sources}/ubuntu.sources`))
    assert.ok(fallback.includes(`Dir::State::lists=${sources}/lists`))
    assert.match(fallback, /APT_CONFIG=\/existing\/proxy.conf/)
  }
})

test('browser library bounds index refresh and propagates installation failures', (t) => {
  const f = fixture(t)
  const apt = f.executable('real-apt', 'exit 100')
  f.executable('timeout', 'printf "%s\\n" "$@" > "$TEST_LOG"; exit 124')
  const script = 'source "$FIXTURE_ROOT/scripts/setup/lib/browser.sh"; '
  const env = { AGENT_BROWSER_APT_GET: apt, AGENT_BROWSER_APT_UPDATE_TIMEOUT: '7' }
  const update = f.shell(script + 'agent_browser_apt_get update', env)
  assert.equal(update.status, 124)
  assert.match(update.stderr, /APT index refresh timeout/)
  assert.match(fs.readFileSync(f.env.TEST_LOG, 'utf8'), /^--kill-after=5s\n7s\n/)
  fs.rmSync(f.env.TEST_LOG)
  assert.equal(f.shell(script + 'agent_browser_apt_get install -y example', env).status, 100)
  assert.equal(
    fs.existsSync(f.env.TEST_LOG),
    false,
    'dpkg installs must not be terminated by the index-refresh timeout',
  )
})
