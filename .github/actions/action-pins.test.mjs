import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const roots = ['.github/actions', '.github/workflows']

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
        if (!reference || reference.startsWith('./')) continue

        const separator = reference.lastIndexOf('@')
        const revision = separator === -1 ? '' : reference.slice(separator + 1)
        if (!/^[0-9a-f]{40}$/.test(revision)) {
          violations.push(`${file}:${index + 1}: ${reference}`)
        }
      }
    }
  }

  assert.deepEqual(violations, [])
})
