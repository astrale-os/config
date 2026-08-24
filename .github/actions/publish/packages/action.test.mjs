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

test('installs publication workspaces from the committed lockfile', () => {
  assert.match(
    action,
    /install-command:\n(?: {4}.+\n)*? {4}default: 'STANDALONE=true pnpm install --frozen-lockfile'/,
  )
  assert.doesNotMatch(action, /--no-frozen-lockfile/)
})

test('keeps the public GitHub Packages mirror explicit and enabled by default', () => {
  assert.match(action, /mirror-public-packages:\n(?: {4}.+\n)*? {4}default: 'true'/)
  assert.match(action, /MIRROR_PUBLIC_PACKAGES: \$\{\{ inputs\.mirror-public-packages \}\}/)
})
