const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

test('repeated setup stages reference the prepared environment once per session', (t) => {
  // Spaces in paths exercise the same entry points used by standalone clones and worktrees.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent setup environment-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const storage = path.join(root, 'tool storage')
  const envFile = path.join(root, 'claude.env')
  fs.mkdirSync(home)
  fs.writeFileSync(envFile, '')
  // Runtimes, browser tools and the repository each persist paths within a single session.
  const persisted = spawnSync(
    'bash',
    [
      '-c',
      'set -euo pipefail\nsource "$1"\nagent_persist_environment\nagent_persist_environment\n' +
        'agent_persist_environment',
      '--',
      path.join(__dirname, 'lib/common.sh'),
    ],
    {
      cwd: os.tmpdir(),
      env: { ...process.env, HOME: home, AGENT_SETUP_HOME: storage, CLAUDE_ENV_FILE: envFile },
      encoding: 'utf8',
      timeout: 15_000,
    },
  )
  assert.equal(persisted.status, 0, persisted.stderr)
  const references = (file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((entry) => entry.includes('# Astrale agent setup')).length
  assert.equal(references(envFile), 1, 'Stages must not stack the same reference')
  assert.equal(references(path.join(home, '.profile')), 1, 'Profiles keep their single reference')
  // Consumers inline this file when no stage referenced it, so PATH must grow exactly once.
  const counted = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-c',
      'source "$1"; printf %s "$PATH" | tr : "\\n" | grep -cFx "$2"',
      '--',
      envFile,
      path.join(storage, 'bin'),
    ],
    { encoding: 'utf8' },
  )
  assert.equal(counted.stdout.trim(), '1', 'The agent bin directory must appear once in PATH')
})
