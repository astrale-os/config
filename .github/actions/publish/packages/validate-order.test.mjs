import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validatePublishOrder } from './validate-order.mjs'

const pkg = (dir, name, fields = {}) => ({ dir, manifest: { name, ...fields } })

test('accepts a producer-before-consumer order', () => {
  assert.doesNotThrow(() =>
    validatePublishOrder([
      pkg('core', '@astrale-os/core'),
      pkg('client', '@astrale-os/client', {
        dependencies: { '@astrale-os/core': '^1.0.0' },
      }),
    ]),
  )
})

test('rejects a consumer before its dependency', () => {
  assert.throws(
    () =>
      validatePublishOrder([
        pkg('client', '@astrale-os/client', {
          dependencies: { '@astrale-os/core': '^1.0.0' },
        }),
        pkg('core', '@astrale-os/core'),
      ]),
    /client.*depends on later package.*core.*dependencies/,
  )
})

test('treats public peer dependencies as producer relationships', () => {
  assert.throws(
    () =>
      validatePublishOrder([
        pkg('react', '@astrale-os/shell-react', {
          peerDependencies: { '@astrale-os/shell': '^1.0.0' },
        }),
        pkg('shell', '@astrale-os/shell'),
      ]),
    /peerDependencies/,
  )
})

test('rejects duplicate package identities', () => {
  assert.throws(
    () =>
      validatePublishOrder([pkg('first', '@astrale-os/core'), pkg('second', '@astrale-os/core')]),
    /Duplicate package/,
  )
})
