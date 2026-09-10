const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const library = path.join(__dirname, '../lib/workspace.sh')
const repos = [
  'admin',
  'cli',
  'config',
  'datastore',
  'domains',
  'gui',
  'kernel',
  'prototype',
  'sdk',
  'shell',
  'ui',
]
function run(cwd, command, args, env = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_ALLOW_PROTOCOL: 'file',
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.com',
      ...env,
    },
  })
}
function git(cwd, ...args) {
  const r = run(cwd, 'git', args)
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-setup-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const upstream = path.join(dir, 'upstream'),
    root = path.join(dir, 'workspace')
  fs.mkdirSync(upstream)
  fs.mkdirSync(root)
  git(upstream, 'init', '-b', 'main')
  fs.writeFileSync(path.join(upstream, 'content'), 'pinned\n')
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-m', 'pinned')
  const pinned = git(upstream, 'rev-parse', 'HEAD')
  git(root, 'init', '-b', 'main')
  for (const repo of repos) git(root, 'submodule', 'add', '-b', 'main', upstream, repo)
  fs.writeFileSync(path.join(root, '.astrale-workspace'), '')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'workspace pins')
  fs.writeFileSync(path.join(upstream, 'content'), 'latest\n')
  git(upstream, 'commit', '-am', 'latest')
  return { root, upstream, pinned, latest: git(upstream, 'rev-parse', 'HEAD') }
}
function setup(root) {
  // Only the common logging/root check are replaced; exercise real Git policy
  // against local remotes with deliberately stale workspace gitlinks.
  return run(
    root,
    'bash',
    [
      '-euo',
      'pipefail',
      '-c',
      'agent_check_repo() { :; }; agent_die() { echo "$*" >&2; exit 1; }; agent_log() { :; }; source "$1"; workspace_update_main',
      'test',
      library,
    ],
    { AGENT_REPO_ROOT: root },
  )
}
test('initial checkout and repeated refresh follow remote main, never gitlink pins', (t) => {
  const f = fixture(t)
  git(f.root, 'submodule', 'deinit', '-f', '--all')
  for (let iteration = 0; iteration < 2; iteration++) {
    const r = setup(f.root)
    assert.equal(r.status, 0, r.stderr)
    for (const repo of repos) {
      assert.equal(git(path.join(f.root, repo), 'rev-parse', 'HEAD'), f.latest)
      assert.equal(git(path.join(f.root, repo), 'branch', '--show-current'), 'main')
      assert.equal(git(f.root, 'rev-parse', `HEAD:${repo}`), f.pinned)
    }
  }
})
test('dirty or untracked child work blocks before any checkout advances', (t) => {
  const f = fixture(t)
  const file = path.join(f.root, 'ui', 'untracked-work')
  fs.writeFileSync(file, 'keep me')
  const r = setup(f.root)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /ui has local changes/)
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep me')
  assert.equal(git(path.join(f.root, 'admin'), 'rev-parse', 'HEAD'), f.pinned)
})
test('unique local commits block without resetting a previously checked repository', (t) => {
  const f = fixture(t),
    child = path.join(f.root, 'ui')
  git(child, 'switch', '-c', 'feature')
  fs.writeFileSync(path.join(child, 'local'), 'preserve')
  git(child, 'add', '.')
  git(child, 'commit', '-m', 'local work')
  const head = git(child, 'rev-parse', 'HEAD')
  const r = setup(f.root)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /commits outside fetched main/)
  assert.equal(git(child, 'rev-parse', 'HEAD'), head)
  assert.equal(git(child, 'branch', '--show-current'), 'feature')
  assert.equal(git(path.join(f.root, 'admin'), 'rev-parse', 'HEAD'), f.pinned)
})
test('an unexpected repository is refused before changing Git state', (t) => {
  const f = fixture(t)
  fs.appendFileSync(
    path.join(f.root, '.gitmodules'),
    '\n[submodule "surprise"]\n path = surprise\n url = example\n',
  )
  const r = setup(f.root)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Unreviewed submodule path/)
  assert.equal(git(path.join(f.root, 'admin'), 'rev-parse', 'HEAD'), f.pinned)
})
