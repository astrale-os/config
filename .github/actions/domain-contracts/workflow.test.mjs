import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ci = await readFile(
  new URL('../../workflows/domain-contract-ci.yml', import.meta.url),
  'utf8',
)
const publish = await readFile(
  new URL('../../workflows/domain-contract-publish.yml', import.meta.url),
  'utf8',
)
const publishAction = await readFile(new URL('./publish/action.yml', import.meta.url), 'utf8')

test('reusable workflows expose plug-and-play callers without Domain inputs or lists', () => {
  for (const workflow of [ci, publish]) {
    assert.match(workflow, /workflow_call:/u)
    assert.doesNotMatch(workflow, /ai-gateway|integrations|issues|services/u)
    assert.doesNotMatch(workflow, /workflow_call:\s*\n\s+inputs:/u)
  }
  assert.match(ci, /uses: \$\/\.github\/actions\/domain-contracts\/qualify/u)
  assert.match(publish, /uses: \$\/\.github\/actions\/domain-contracts\/publish/u)
})

test('publication serializes one repository ref and uses exact qualified tarballs', () => {
  assert.match(
    publish,
    /group: domain-contract-publish-\$\{\{ github\.repository \}\}-\$\{\{ github\.ref \}\}/u,
  )
  assert.match(publish, /cancel-in-progress: false/u)
  assert.match(publishAction, /uses: \$\/\.github\/actions\/domain-contracts\/qualify/u)
  assert.match(publishAction, /uses: \$\/\.github\/actions\/publish\/packages/u)
  assert.match(publishAction, /tarballs-json: \$\{\{ steps\.contracts\.outputs\.tarballs \}\}/u)
})
