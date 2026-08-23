import assert from 'node:assert/strict'
import { test } from 'node:test'

import { publishedStatus, versionMetadataUrl } from './check-published.mjs'

test('builds the official immutable version metadata URL', () => {
  assert.equal(
    versionMetadataUrl('@astrale/commitlint-config', '2.0.4'),
    'https://jsr.io/@astrale/commitlint-config/2.0.4_meta.json',
  )
})

test('only HTTP 200 is classified as already published', async () => {
  const fetchImpl = async () => ({ status: 200 })

  assert.equal(
    await publishedStatus({
      name: '@astrale/commitlint-config',
      version: '2.0.4',
      fetchImpl,
    }),
    'published',
  )
})

test('HTTP 404 is classified as absent', async () => {
  const fetchImpl = async () => ({ status: 404 })

  assert.equal(
    await publishedStatus({
      name: '@astrale/commitlint-config',
      version: '2.0.4',
      fetchImpl,
    }),
    'absent',
  )
})

test('authorization and registry errors remain fatal', async () => {
  for (const status of [401, 403, 429, 500]) {
    const fetchImpl = async () => ({ status })

    await assert.rejects(
      publishedStatus({
        name: '@astrale/commitlint-config',
        version: '2.0.4',
        fetchImpl,
      }),
      new RegExp(`HTTP ${status}`),
    )
  }
})

test('network failures remain fatal', async () => {
  const fetchImpl = async () => {
    throw new Error('network unavailable')
  }

  await assert.rejects(
    publishedStatus({
      name: '@astrale/commitlint-config',
      version: '2.0.4',
      fetchImpl,
    }),
    /network unavailable/,
  )
})
