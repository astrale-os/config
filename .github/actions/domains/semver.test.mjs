import assert from 'node:assert/strict'
import test from 'node:test'

import { satisfies } from './semver.mjs'

test('supports ordinary exact, caret, tilde, comparator, wildcard, and union ranges', () => {
  assert.equal(satisfies('1.2.3', '1.2.3'), true)
  assert.equal(satisfies('1.9.0', '^1.2.3'), true)
  assert.equal(satisfies('2.0.0', '^1.2.3'), false)
  assert.equal(satisfies('0.2.9', '^0.2.3'), true)
  assert.equal(satisfies('0.3.0', '^0.2.3'), false)
  assert.equal(satisfies('1.2.9', '~1.2.3'), true)
  assert.equal(satisfies('1.3.0', '~1.2.3'), false)
  assert.equal(satisfies('1.5.0', '>=1.2.0 <2.0.0'), true)
  assert.equal(satisfies('2.1.0', '1.x || >=2.1.0 <3'), true)
  assert.equal(satisfies('1.2.1', '>1.2'), false)
  assert.equal(satisfies('1.3.0', '>1.2'), true)
  assert.equal(satisfies('1.2.5', '<=1.2'), true)
  assert.equal(satisfies('1.3.0', '<=1.2'), false)
  assert.equal(satisfies('2.3.9', '1.2.3 - 2.3'), true)
  assert.equal(satisfies('2.4.0', '1.2.3 - 2.3'), false)
})

test('admits prereleases only when the comparator set names the same release tuple', () => {
  assert.equal(satisfies('1.1.0-beta.1', '^1.0.0'), false)
  assert.equal(satisfies('1.0.0-beta.2', '^1.0.0-beta.1'), true)
  assert.equal(satisfies('1.1.0-beta.1', '^1.0.0-beta.1'), false)
  assert.equal(satisfies('1.0.0-beta.2', '>=1.0.0-beta.1 <2.0.0'), true)
})

test('rejects workspace and path substitutions as authored dependency ranges', () => {
  assert.throws(() => satisfies('1.0.0', 'workspace:*'), /published semver range/u)
  assert.throws(() => satisfies('1.0.0', 'file:..\/producer'), /published semver range/u)
})
