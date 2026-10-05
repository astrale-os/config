const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const packageRoot = path.resolve(__dirname, '..')
const sourcePackages = [
  'core',
  'dsl',
  'protocol',
  'ports',
  'runtime',
  'server',
  'host',
  'client',
  'backend',
  '__e2e__',
]
const legacyPackages = ['test', 'test/src/web']

function fixture(t, legacy = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-setup-test-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), value)
  }
  write(
    'scripts/setup/repo.sh',
    'export AGENT_SETUP_PROFILE=kernel AGENT_SETUP_BROWSER=0 AGENT_SETUP_ASTRALE_CLI=0 KERNEL_SETUP_NATIVE_FALKORDB=0 KERNEL_SETUP_DOCKER=0\n',
  )
  write('.nvmrc', '26.7.0\n')
  write('.bun-version', '1.4.2\n')
  write('package.json', '{"packageManager":"pnpm@12.1.0"}')
  const packages = legacy ? [...sourcePackages, ...legacyPackages] : [...sourcePackages]
  const workspace = (names = packages) =>
    write(
      'pnpm-workspace.yaml',
      'packages:\n' +
        names.map((name) => "  - '" + name + "'\n").join('') +
        'sharedWorkspaceLockfile: true\n',
    )
  workspace()
  for (const name of packages) {
    write(
      name + '/package.json',
      JSON.stringify({ name: name === 'test' ? '@astrale-os/kernel-test' : name }),
    )
    fs.mkdirSync(path.join(root, name, 'node_modules'))
  }
  if (legacy) {
    write('test/cli/build.mjs', 'fixture\n')
    write('test/dist/cli/kernel-test.mjs', 'fixture\n')
    write('test/dist/cli/inputs.json', '{}\n')
  }
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0)
  return {
    root,
    write,
    workspace,
    shell(body) {
      return spawnSync(
        'bash',
        [
          '-euo',
          'pipefail',
          '-c',
          'source "$PACKAGE_DIR/lib/common.sh"; agent_load_config; source "$PACKAGE_DIR/profiles/kernel.sh"; cd "$AGENT_REPO_ROOT"; ' +
            body,
        ],
        {
          cwd: '/',
          encoding: 'utf8',
          env: {
            ...process.env,
            AGENT_REPO_ROOT: root,
            AGENT_SETUP_HOME: path.join(root, 'storage'),
            AGENT_SETUP_TOOLS: 'check',
            PACKAGE_DIR: packageRoot,
          },
        },
      )
    },
  }
}

const noRuntimes =
  'node() { echo unexpected-node >&2; return 99; }; pnpm() { echo unexpected-pnpm >&2; return 99; }; bun() { echo unexpected-bun >&2; return 99; }; '
const probes =
  'pnpm() { printf "pnpm %s\\n" "$*"; [[ "$*" != *build* && "$*" != *install* ]] || return 99; }; node() { printf "node %s root=%s\\n" "$*" "\${KERNEL_TEST_SOURCE_ROOT:-}"; }; '

test('Kernel preflight admits declared source owners with or without Legacy Test before runtimes', (t) => {
  for (const legacy of [false, true]) {
    const f = fixture(t, legacy)
    const result = f.shell(noRuntimes + 'repo_preflight')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
  }
})

test('declared Kernel source owners remain mandatory even when their files exist', (t) => {
  for (const name of sourcePackages) {
    const f = fixture(t)
    f.workspace(sourcePackages.filter((owner) => owner !== name))
    const result = f.shell(noRuntimes + 'repo_preflight')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, new RegExp('missing package declaration ' + name + '\\b'))
    assert.doesNotMatch(result.stderr, /unexpected-/)
  }
})

test('missing production manifests and Legacy inputs fail before runtime preparation', (t) => {
  for (const name of [
    ...sourcePackages.map((owner) => owner + '/package.json'),
    'test/package.json',
    'test/src/web/package.json',
    'test/cli/build.mjs',
  ]) {
    const f = fixture(t, true)
    fs.unlinkSync(path.join(f.root, name))
    const result = f.shell(noRuntimes + 'repo_preflight')
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('missing ' + name), result.stderr)
    assert.doesNotMatch(result.stderr, /unexpected-/)
  }
})

test('partial Test or Web declarations fail even when both physical directories are complete', (t) => {
  for (const owner of legacyPackages) {
    const f = fixture(t, true)
    f.workspace([...sourcePackages, owner])
    const result = f.shell(noRuntimes + 'repo_preflight')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Test and Web must be declared together/)
  }
})

test('ownership follows only explicit packages entries and ignores undeclared Test remnants', (t) => {
  const f = fixture(t, true)
  f.write(
    'pnpm-workspace.yaml',
    'packages: # declared ownership\r\n' +
      sourcePackages
        .map((name, i) => '  - ' + (i % 2 ? name : '"' + name + '"') + ' # source\r\n')
        .join('') +
      '\r\nminimumReleaseAgeExclude:\r\n  - test\r\n  - test/src/web\r\n',
  )
  const result = f.shell(noRuntimes + 'repo_preflight; if kernel_workbench_owned; then exit 98; fi')
  assert.equal(result.status, 0, result.stderr)
})

test('unsupported or ambiguous workspace ownership cannot silently skip Legacy Test', (t) => {
  const f = fixture(t)
  const valid = fs.readFileSync(path.join(f.root, 'pnpm-workspace.yaml'), 'utf8')
  for (const text of [
    'sharedWorkspaceLockfile: true\n',
    "packages: ['core', 'test']\n",
    valid + 'packages:\n  - test\n',
    valid.replace("  - 'core'", "  - 'core'\n  - core"),
    valid.replace("  - 'core'", "  - 'core"),
    valid.replace("  - 'core'", '  - *owners'),
    valid.replace("  - 'core'", "  - 'core/*'"),
    valid + 'packages: &owners\n  - test\n',
    valid.replace("  - 'core'", "  - './core'"),
  ]) {
    f.write('pnpm-workspace.yaml', text)
    const result = f.shell(noRuntimes + 'repo_preflight')
    assert.notEqual(result.status, 0, text)
    assert.match(result.stderr, /explicit workspace package paths/)
    assert.doesNotMatch(result.stderr, /unexpected-/)
  }
})

test('source Kernel verification probes Host Vitest and source dependencies without Test commands', (t) => {
  const f = fixture(t)
  const result = f.shell(probes + 'repo_verify')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^pnpm --dir host exec vitest --version$/m)
  for (const owner of sourcePackages)
    assert.ok(result.stdout.includes('pnpm --dir ' + owner + ' exec tsc --version\n'))
  assert.match(result.stdout, /^pnpm exec tsgo --version$/m)
  assert.match(result.stdout, /^pnpm exec cg --version$/m)
  assert.doesNotMatch(result.stdout, /--dir test|kernel-test|^node /m)
  fs.rmSync(path.join(f.root, 'backend/node_modules'), { recursive: true })
  const missing = f.shell(probes + 'repo_verify')
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /Missing Kernel workspace dependencies: backend/)
})

test('Legacy verification retains its dependency and direct bundle probes without regeneration', (t) => {
  const f = fixture(t, true)
  const result = f.shell(probes + 'repo_verify')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^pnpm --dir host exec vitest --version$/m)
  assert.match(result.stdout, /^pnpm --dir test exec vitest --version$/m)
  assert.match(result.stdout, /^pnpm --dir test exec tsc --version$/m)
  assert.match(result.stdout, /^pnpm --dir test\/src\/web exec tsc --version$/m)
  assert.ok(
    result.stdout.includes('node test/dist/cli/kernel-test.mjs --help root=' + f.root + '/test\n'),
  )
  for (const name of ['test/dist/cli/kernel-test.mjs', 'test/dist/cli/inputs.json']) {
    const bytes = fs.readFileSync(path.join(f.root, name))
    fs.unlinkSync(path.join(f.root, name))
    const missing = f.shell(probes + 'repo_verify')
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /Prepared kernel-test bundle is missing/)
    assert.doesNotMatch(missing.stdout, /build|install|^node /m)
    f.write(name, bytes)
  }
})

test('Kernel verification propagates a failed source probe', (t) => {
  const f = fixture(t)
  const result = f.shell(
    'pnpm() { [[ "$*" != "--dir host exec vitest --version" ]] || return 42; }; repo_verify',
  )
  assert.equal(result.status, 42)
})

test('standalone provider preparation does not duplicate the root Legacy CLI build', (t) => {
  const f = fixture(t, true)
  const result = f.shell('pnpm() { echo unexpected-build >&2; return 99; }; repo_prepare')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
})

test('integrated artifact preparation builds exactly a declared Legacy owner and rejects unmatched filters', (t) => {
  for (const legacy of [false, true]) {
    const f = fixture(t, legacy)
    const result = f.shell('pnpm() { printf "%s\\n" "$*"; }; repo_prepare_workbench')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      result.stdout,
      legacy ? '--filter @astrale-os/kernel-test --fail-if-no-match run build:cli\n' : '',
    )
    if (legacy) {
      const unmatched = f.shell(
        'pnpm() { [[ "$*" != *--fail-if-no-match* ]] || return 1; }; repo_prepare_workbench',
      )
      assert.equal(unmatched.status, 1)
    }
  }
})

function integratedFixture(f) {
  const root = path.join(f.root, 'integrated')
  fs.mkdirSync(root)
  fs.symlinkSync(f.root, path.join(root, 'kernel'))
  fs.writeFileSync(path.join(root, '.bun-version'), '1.4.2\n')
  for (const name of ['cli', 'prototype']) {
    fs.mkdirSync(path.join(root, name))
    fs.writeFileSync(path.join(root, name, '.git'), 'fixture')
    fs.writeFileSync(path.join(root, name, '.bun-version'), '1.4.2\n')
  }
  return 'export AGENT_REPO_ROOT="$AGENT_REPO_ROOT/integrated" AGENT_SETUP_BROWSER=1 AGENT_SETUP_ASTRALE_CLI=1; source "$PACKAGE_DIR/profiles/workspace.sh"; '
}

test('Workspace routes Legacy artifacts through the Kernel profile and skips absent Test ownership', (t) => {
  for (const legacy of [false, true]) {
    const f = fixture(t, legacy)
    const body =
      integratedFixture(f) +
      [
        'workspace_partial() { return 1; }',
        'workspace_pnpm() { printf "workspace %s\\n" "$*"; }',
        'eval "$(declare -f workspace_profile | sed \'1s/workspace_profile/invoke_profile/\')"',
        'workspace_profile() { if [[ "$1" == kernel ]]; then invoke_profile "$@"; fi; }',
        'repo_prepare',
      ].join('\n')
    const result = f.shell(body)
    assert.equal(result.status, 0, result.stderr)
    const testBuilds = result.stdout
      .split('\n')
      .filter((line) => line.includes('@astrale-os/kernel-test'))
    assert.equal(testBuilds.length, legacy ? 1 : 0, result.stdout)
    if (legacy)
      assert.match(
        testBuilds[0],
        /--filter @astrale-os\/kernel-test --fail-if-no-match run build:cli$/,
      )
    assert.match(result.stdout, /\/cli run build\n$/)
    if (legacy) {
      fs.unlinkSync(path.join(f.root, 'test/package.json'))
      const incomplete = f.shell(body)
      assert.notEqual(incomplete.status, 0)
      assert.match(incomplete.stderr, /missing test\/package.json/)
      assert.doesNotMatch(incomplete.stdout, /@astrale-os\/kernel-test|\/cli run build/)
    }
  }
})

test('complete Workspace validates Kernel ownership before runtimes while partial Workspace keeps its skip', (t) => {
  const f = fixture(t, true)
  const prefix =
    integratedFixture(f) +
    noRuntimes +
    [
      'workspace_update_main() { :; }',
      'workspace_check_manifests() { :; }',
      'workspace_missing_paths() { printf "datastore\\n"; }',
    ].join('\n') +
    '\n'
  const complete = f.shell(prefix + 'workspace_partial() { return 1; }; repo_checkout')
  assert.equal(complete.status, 0, complete.stderr)
  fs.unlinkSync(path.join(f.root, 'test/package.json'))
  const incomplete = f.shell(prefix + 'workspace_partial() { return 1; }; repo_checkout')
  assert.notEqual(incomplete.status, 0)
  assert.match(incomplete.stderr, /missing test\/package.json/)
  assert.doesNotMatch(incomplete.stderr, /unexpected-/)
  const partial = f.shell(
    prefix +
      'workspace_partial() { return 0; }; repo_checkout; workspace_profile() { echo unexpected-product >&2; return 99; }; repo_prepare',
  )
  assert.equal(partial.status, 0, partial.stderr)
  assert.match(partial.stdout, /partial Workspace/)
  assert.doesNotMatch(partial.stderr, /unexpected-/)
})

test('integrated verification rechecks declared Kernel ownership and manifests with installed modules retained', (t) => {
  for (const missing of ['declaration', 'manifest']) {
    const f = fixture(t)
    const prefix =
      integratedFixture(f) + probes + 'workspace_pnpm() { shift; printf "pnpm %s\\n" "$*"; }; '
    const admitted = f.shell(prefix + 'workspace_profile kernel verify')
    assert.equal(admitted.status, 0, admitted.stderr)
    if (missing === 'declaration') f.workspace(sourcePackages.filter((name) => name !== 'core'))
    else fs.unlinkSync(path.join(f.root, 'core/package.json'))
    const result = f.shell(prefix + 'workspace_profile kernel verify')
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      missing === 'declaration' ? /missing package declaration core/ : /missing core\/package.json/,
    )
    assert.equal(result.stdout, '')
    assert.ok(fs.existsSync(path.join(f.root, 'core/node_modules')))
  }
})

test('every declared additional owner requires its manifest before runtime preparation', (t) => {
  for (const owner of ['__e2e__/client-runtime', 'norm', 'another-owner']) {
    const f = fixture(t)
    f.workspace([...sourcePackages, owner])
    f.write(owner + '/package.json', JSON.stringify({ name: owner }))
    const complete = f.shell(noRuntimes + 'repo_preflight')
    assert.equal(complete.status, 0, complete.stderr)
    fs.unlinkSync(path.join(f.root, owner, 'package.json'))
    const incomplete = f.shell(noRuntimes + 'repo_preflight')
    assert.notEqual(incomplete.status, 0)
    assert.ok(incomplete.stderr.includes('missing ' + owner + '/package.json'), incomplete.stderr)
    assert.doesNotMatch(incomplete.stderr, /unexpected-/)
  }
})
