import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const action = await readFile(new URL('./action.yml', import.meta.url), 'utf8')

test('pins the publisher npm toolchain to one immutable npm 11 release', () => {
  const installs = [...action.matchAll(/npm install -g npm@(\S+)/g)]

  assert.equal(installs.length, 1, 'expected exactly one global npm installation')
  assert.match(
    installs[0][1],
    /^11\.\d+\.\d+$/,
    'publisher npm must be an exact stable npm 11 version, never a range or dist-tag',
  )
})
