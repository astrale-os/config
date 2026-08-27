import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const roots = ['.github/actions', '.github/workflows']
const qualifiedConfigRevision = '9bffee57d53b603b556bb545145fdde10f20a4c5'
const explicitConfigPlaceholder = '<CONFIG_ACTION_SHA>'
const node24CompatibleActionRevisions = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['astrale-os/config', qualifiedConfigRevision],
  ['docker/build-push-action', '53b7df96c91f9c12dcc8a07bcb9ccacbed38856a'],
  ['docker/login-action', 'dbcb813823bdd20940b903addbd779551569679f'],
  ['docker/setup-buildx-action', '37fe631027851001ddb9b187196cc803df7f5f0e'],
  ['google-github-actions/auth', '7c6bc770dae815cd3e89ee6cdf493a5fab2cc093'],
  ['googleapis/release-please-action', '45996ed1f6d02564a971a2fa1b5860e934307cf7'],
  ['imjasonh/setup-crane', '31b88efe9de28ae0ffa220711af4b60be9435f6e'],
  ['pnpm/action-setup', '0977fd99725f1db4007ccb2928dbb4e90d06cc86'],
])

async function yamlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await yamlFiles(file)))
    else if (/\.ya?ml$/.test(entry.name)) files.push(file)
  }

  return files
}

test('executable remote actions use immutable commit SHAs', async () => {
  const violations = []

  for (const root of roots) {
    for (const file of await yamlFiles(root)) {
      const source = await readFile(file, 'utf8')
      const lines = source.split('\n')

      for (const [index, line] of lines.entries()) {
        const reference = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/)?.[1]
        if (!reference || reference.startsWith('./') || reference.startsWith('$/')) continue

        const separator = reference.lastIndexOf('@')
        const revision = separator === -1 ? '' : reference.slice(separator + 1)
        if (!/^[0-9a-f]{40}$/.test(revision)) {
          violations.push(`${file}:${index + 1}: ${reference}`)
        } else if (
          reference.startsWith('astrale-os/config/.github/') &&
          revision !== qualifiedConfigRevision
        ) {
          violations.push(`${file}:${index + 1}: ${reference}`)
        }
      }
    }
  }

  assert.deepEqual(violations, [])
})

test('remote actions use audited Node 24-compatible revisions', async () => {
  const violations = []

  for (const root of roots) {
    for (const file of await yamlFiles(root)) {
      const source = await readFile(file, 'utf8')
      const lines = source.split('\n')

      for (const [index, line] of lines.entries()) {
        const reference = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/)?.[1]
        if (!reference || reference.startsWith('./') || reference.startsWith('$/')) continue

        const separator = reference.lastIndexOf('@')
        const action = separator === -1 ? reference : reference.slice(0, separator)
        const repository = action.split('/').slice(0, 2).join('/')
        const revision = separator === -1 ? '' : reference.slice(separator + 1)
        const auditedRevision = node24CompatibleActionRevisions.get(repository)

        if (revision !== auditedRevision) {
          violations.push(`${file}:${index + 1}: ${reference}`)
        }
      }
    }
  }

  assert.deepEqual(violations, [])
})

test('Config examples use the qualified revision or an explicit immutable placeholder', async () => {
  const files = [
    'README.md',
    ...(await referenceFiles('.github')),
    ...(await referenceFiles('github')),
  ]
  const violations = []
  const pattern = /astrale-os\/config\/\.github\/(?:actions|workflows)\/[^\s`"'#@]+@([^\s`"'#]+)/gu

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      const revision = match[1]
      if (revision === qualifiedConfigRevision || revision === explicitConfigPlaceholder) continue
      const line = source.slice(0, match.index).split('\n').length
      violations.push(`${file}:${line}: ${match[0]}`)
    }
  }

  assert.deepEqual(violations, [])
})

async function referenceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await referenceFiles(file)))
    else if (/\.(?:md|ya?ml|[cm]?js|ts|json)$/.test(entry.name)) files.push(file)
  }

  return files
}
