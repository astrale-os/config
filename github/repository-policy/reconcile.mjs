#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const POLICY_URL = new URL('./policy.json', import.meta.url)
const API_VERSION = '2022-11-28'
const MANAGED_SETTINGS = [
  'allow_merge_commit',
  'allow_rebase_merge',
  'allow_squash_merge',
  'squash_merge_commit_title',
  'squash_merge_commit_message',
  'delete_branch_on_merge',
]

const TITLE_VALUES = new Set(['PR_TITLE', 'COMMIT_OR_PR_TITLE'])
const MESSAGE_VALUES = new Set(['PR_BODY', 'COMMIT_MESSAGES', 'BLANK'])

function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`)
  }
}

export function validatePolicy(value) {
  assertRecord(value, 'Repository policy')

  if (typeof value.organization !== 'string' || !value.organization.trim()) {
    throw new TypeError('Repository policy organization must be a non-empty string.')
  }
  if (!Array.isArray(value.repositories) || value.repositories.length === 0) {
    throw new TypeError('Repository policy repositories must be a non-empty array.')
  }
  if (
    value.repositories.some((repository) => typeof repository !== 'string' || !repository.trim())
  ) {
    throw new TypeError('Repository policy repository names must be non-empty strings.')
  }
  if (new Set(value.repositories).size !== value.repositories.length) {
    throw new TypeError('Repository policy repository names must be unique.')
  }

  assertRecord(value.settings, 'Repository policy settings')
  const settingNames = Object.keys(value.settings)
  const unknownSettings = settingNames.filter((name) => !MANAGED_SETTINGS.includes(name))
  const missingSettings = MANAGED_SETTINGS.filter((name) => !settingNames.includes(name))
  if (unknownSettings.length || missingSettings.length) {
    throw new TypeError(
      `Repository policy settings mismatch. Missing: ${missingSettings.join(', ') || 'none'}; unknown: ${unknownSettings.join(', ') || 'none'}.`,
    )
  }

  for (const name of [
    'allow_merge_commit',
    'allow_rebase_merge',
    'allow_squash_merge',
    'delete_branch_on_merge',
  ]) {
    if (typeof value.settings[name] !== 'boolean') {
      throw new TypeError(`Repository policy setting ${name} must be boolean.`)
    }
  }
  if (!TITLE_VALUES.has(value.settings.squash_merge_commit_title)) {
    throw new TypeError('Repository policy squash_merge_commit_title is invalid.')
  }
  if (!MESSAGE_VALUES.has(value.settings.squash_merge_commit_message)) {
    throw new TypeError('Repository policy squash_merge_commit_message is invalid.')
  }
  if (!value.settings.allow_squash_merge) {
    throw new TypeError('Repository policy must keep squash merging enabled.')
  }

  return value
}

export function settingsDrift(current, desired) {
  return Object.fromEntries(
    MANAGED_SETTINGS.filter((name) => current[name] !== desired[name]).map((name) => [
      name,
      { current: current[name], desired: desired[name] },
    ]),
  )
}

export async function githubApi(endpoint, { method = 'GET', body } = {}) {
  const args = [
    'api',
    endpoint,
    '--header',
    'Accept: application/vnd.github+json',
    '--header',
    `X-GitHub-Api-Version: ${API_VERSION}`,
  ]
  if (method !== 'GET') args.push('--method', method)
  if (body !== undefined) args.push('--input', '-')

  return await new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`GitHub API ${method} ${endpoint} failed: ${stderr.trim()}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(
          new Error(`GitHub API ${method} ${endpoint} returned invalid JSON: ${error.message}`),
        )
      }
    })
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

export async function reconcileRepository({ api, organization, repository, settings, apply }) {
  const endpoint = `repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}`
  const before = await api(endpoint)
  const driftBefore = settingsDrift(before, settings)

  if (apply && Object.keys(driftBefore).length > 0) {
    await api(endpoint, { method: 'PATCH', body: settings })
  }

  const after = apply && Object.keys(driftBefore).length > 0 ? await api(endpoint) : before
  const driftAfter = settingsDrift(after, settings)
  return {
    repository: `${organization}/${repository}`,
    changed: apply && Object.keys(driftBefore).length > 0,
    driftBefore,
    driftAfter,
  }
}

export async function reconcilePolicy(policy, { apply = false, api = githubApi } = {}) {
  validatePolicy(policy)
  const results = []
  for (const repository of policy.repositories) {
    results.push(
      await reconcileRepository({
        api,
        organization: policy.organization,
        repository,
        settings: policy.settings,
        apply,
      }),
    )
  }
  return results
}

function printDrift(drift) {
  return Object.entries(drift)
    .map(
      ([name, values]) =>
        `${name}=${JSON.stringify(values.current)} -> ${JSON.stringify(values.desired)}`,
    )
    .join(', ')
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !['--check', '--apply'].includes(argv[0])) {
    throw new TypeError('Usage: node github/repository-policy/reconcile.mjs --check|--apply')
  }
  const apply = argv[0] === '--apply'
  const policy = JSON.parse(await readFile(POLICY_URL, 'utf8'))
  const results = await reconcilePolicy(policy, { apply })

  let failed = false
  for (const result of results) {
    if (Object.keys(result.driftAfter).length > 0) {
      failed = true
      console.error(`✗ ${result.repository}: ${printDrift(result.driftAfter)}`)
    } else if (result.changed) {
      console.log(`✓ ${result.repository}: reconciled (${printDrift(result.driftBefore)})`)
    } else {
      console.log(`✓ ${result.repository}: converged`)
    }
  }
  if (failed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
