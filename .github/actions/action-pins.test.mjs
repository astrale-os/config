import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const roots = ['.github/actions', '.github/workflows']
const qualifiedConfigRevision = 'e89c7e84ed0b5bad2dcbf80f7a4547e30672155e'
const explicitConfigPlaceholder = '<CONFIG_ACTION_SHA>'

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
