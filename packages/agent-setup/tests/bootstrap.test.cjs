const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'setup package test ')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo with spaces')
  const scripts = path.join(repo, 'scripts/setup')
  const bin = path.join(root, 'bin')
  const pkg = path.join(root, 'source/package')
  for (const dir of [scripts, bin, pkg]) fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(__dirname, '../bootstrap/setup.sh'), path.join(scripts, 'setup.sh'))
  fs.writeFileSync(path.join(pkg, 'run.sh'), 'printf "%s\\n%s\\n" "$1" "$2" > "$RESULT"\n')
  const archive = path.join(root, 'source.tgz')
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', path.dirname(pkg), 'package']).status, 0)
  const hash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  fs.writeFileSync(path.join(scripts, 'setup.lock'), `0.1.0 ${hash}\n`)
  fs.writeFileSync(
    path.join(bin, 'curl'),
    '#!/bin/bash\necho download >> "$CALLS"\nwhile [[ "$1" != -o ]]; do shift; done\ncp "$SOURCE_ARCHIVE" "$2"\n',
    { mode: 0o755 },
  )
  const env = {
    ...process.env,
    HOME: root,
    XDG_CACHE_HOME: path.join(root, 'cache'),
    PATH: `${bin}:${process.env.PATH}`,
    SOURCE_ARCHIVE: archive,
    CALLS: path.join(root, 'calls'),
    RESULT: path.join(root, 'result'),
  }
  return {
    root,
    repo,
    scripts,
    archive,
    hash,
    env,
    run: (action, extra = {}) =>
      spawnSync('bash', [path.join(scripts, 'setup.sh'), action], {
        env: { ...env, ...extra },
        encoding: 'utf8',
      }),
  }
}

test('bootstrap downloads once, uses explicit repo path and verifies cached bytes', (t) => {
  const f = fixture(t)
  let result = f.run('prepare')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(f.env.RESULT, 'utf8'), `${f.repo}\nprepare\n`)
  result = f.run('verify')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(f.env.CALLS, 'utf8'), 'download\n')
  fs.writeFileSync(
    path.join(f.env.XDG_CACHE_HOME, 'astrale-agent-setup/0.1.0', f.hash, 'package.tgz'),
    'corrupt',
  )
  assert.notEqual(f.run('verify').status, 0)
  assert.equal(fs.readFileSync(f.env.CALLS, 'utf8'), 'download\n')
})

test('untrusted download never executes and next preparation can retry', (t) => {
  const f = fixture(t)
  const bad = path.join(f.root, 'bad.tgz')
  fs.writeFileSync(bad, 'bad')
  assert.notEqual(f.run('prepare', { SOURCE_ARCHIVE: bad }).status, 0)
  assert.equal(fs.existsSync(f.env.RESULT), false)
  assert.equal(f.run('prepare').status, 0)
})

test('verify and local Claude do not fetch a missing package', (t) => {
  const f = fixture(t)
  assert.notEqual(f.run('verify').status, 0)
  assert.equal(f.run('claude', { CLAUDE_CODE_REMOTE: '' }).status, 0)
  assert.equal(fs.existsSync(f.env.CALLS), false)
})

test('invalid pin is refused before network or execution', (t) => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.scripts, 'setup.lock'), `latest ${f.hash}\n`)
  assert.notEqual(f.run('prepare').status, 0)
  assert.equal(fs.existsSync(f.env.CALLS), false)
})
