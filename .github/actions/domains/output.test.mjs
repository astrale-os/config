import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { writeOutput } from './output.mjs'

test('keeps space-separated package directories unquoted for composite action inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'domain-action-output-'))
  const file = join(root, 'output')

  await writeOutput('dirs', 'ai-gateway integrations issues services', file)
  await writeOutput('has-selected', true, file)
  await writeOutput('tarballs', { integrations: '/tmp/integrations.tgz' }, file)

  assert.equal(
    await readFile(file, 'utf8'),
    'dirs=ai-gateway integrations issues services\n' +
      'has-selected=true\n' +
      'tarballs={"integrations":"/tmp/integrations.tgz"}\n',
  )
})
