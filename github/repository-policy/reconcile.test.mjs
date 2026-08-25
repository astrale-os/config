import assert from 'node:assert/strict'
import test from 'node:test'

import { reconcilePolicy, settingsDrift, validatePolicy } from './reconcile.mjs'

const settings = {
  allow_merge_commit: false,
  allow_rebase_merge: false,
  allow_squash_merge: true,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'BLANK',
  delete_branch_on_merge: true,
}

const policy = {
  organization: 'astrale-os',
  repositories: ['kernel'],
  settings,
}

test('validates the closed repository policy shape', () => {
  assert.equal(validatePolicy(policy), policy)
  assert.throws(
    () => validatePolicy({ ...policy, repositories: ['kernel', 'kernel'] }),
    /must be unique/,
  )
  assert.throws(
    () => validatePolicy({ ...policy, settings: { ...settings, unmanaged: true } }),
    /settings mismatch/,
  )
  assert.throws(
    () => validatePolicy({ ...policy, settings: { ...settings, allow_squash_merge: false } }),
    /must keep squash merging enabled/,
  )
})

test('reports drift only for managed settings', () => {
  assert.deepEqual(
    settingsDrift({ ...settings, allow_merge_commit: true, unrelated: 'ignored' }, settings),
    { allow_merge_commit: { current: true, desired: false } },
  )
})

test('check mode observes drift without writing', async () => {
  const calls = []
  const api = async (endpoint, options) => {
    calls.push({ endpoint, options })
    return { ...settings, allow_rebase_merge: true }
  }

  const [result] = await reconcilePolicy(policy, { api })
  assert.equal(result.repository, 'astrale-os/kernel')
  assert.deepEqual(result.driftAfter, {
    allow_rebase_merge: { current: true, desired: false },
  })
  assert.deepEqual(calls, [{ endpoint: 'repos/astrale-os/kernel', options: undefined }])
})

test('apply mode patches exact settings and verifies convergence', async () => {
  const calls = []
  let current = { ...settings, allow_merge_commit: true, delete_branch_on_merge: false }
  const api = async (endpoint, options) => {
    calls.push({ endpoint, options })
    if (options?.method === 'PATCH') current = { ...current, ...options.body }
    return current
  }

  const [result] = await reconcilePolicy(policy, { apply: true, api })
  assert.equal(result.changed, true)
  assert.deepEqual(result.driftAfter, {})
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[1], {
    endpoint: 'repos/astrale-os/kernel',
    options: { method: 'PATCH', body: settings },
  })
})
