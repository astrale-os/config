const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

test('release archive contains runnable entrypoints and its digest matches the delivered bytes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup release '))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const root = path.resolve(__dirname, '..')
  const version = require('../package.json').version
  const packed = spawnSync('bash', [path.join(root, 'pack.sh'), directory], { encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)
  const name = `astrale-setup-${version}.tar.gz`
  const archive = path.join(directory, name)
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  assert.equal(fs.readFileSync(`${archive}.sha256`, 'utf8').trim(), `${digest}  ${name}`)
  assert.equal(spawnSync('tar', ['-xzf', archive, '-C', directory]).status, 0)
  const unpacked = path.join(directory, 'package')
  assert.equal(fs.existsSync(path.join(unpacked, 'tests')), false)
  assert.equal(fs.existsSync(path.join(unpacked, 'node_modules')), false)
  for (const entry of [
    'run.sh',
    'bootstrap/setup.sh',
    'profiles/config.sh',
    'profiles/sdk.sh',
    'profiles/gui.sh',
    'lib/common.sh',
    'lib/claude.sh',
  ]) {
    assert.equal(spawnSync('bash', ['-n', path.join(unpacked, entry)]).status, 0, entry)
  }
  const result = spawnSync('bash', [path.join(unpacked, 'run.sh')], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Usage: run.sh REPOSITORY/)
})
