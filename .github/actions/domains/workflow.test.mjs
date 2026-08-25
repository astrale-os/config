import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ci = await readFile(new URL('../../workflows/domains-ci.yml', import.meta.url), 'utf8')
const publish = await readFile(
  new URL('../../workflows/domains-publish.yml', import.meta.url),
  'utf8',
)
const publishAction = await readFile(new URL('./publish/action.yml', import.meta.url), 'utf8')
const qualifyAction = await readFile(new URL('./qualify/action.yml', import.meta.url), 'utf8')

test('reusable workflows expose plug-and-play callers without Domain inputs or lists', () => {
  for (const workflow of [ci, publish]) {
    assert.match(workflow, /workflow_call:/u)
    assert.doesNotMatch(workflow, /ai-gateway|integrations|issues|services/u)
    assert.doesNotMatch(workflow, /workflow_call:\s*\n\s+inputs:/u)
  }
  assert.match(ci, /uses: \$\/\.github\/actions\/domains\/qualify/u)
  assert.match(publish, /uses: \$\/\.github\/actions\/domains\/publish/u)
  assert.match(qualifyAction, /node-version: 26\.7\.0/u)
  assert.doesNotMatch(qualifyAction, /node-version-file/u)
})

test('publication queues the repository and uses exact qualified tarballs', () => {
  assert.match(publish, /group: domains-publish-\$\{\{ github\.repository \}\}/u)
  assert.match(publish, /queue: max/u)
  assert.doesNotMatch(publish, /github\.ref/u)
  assert.match(publishAction, /uses: \$\/\.github\/actions\/domains\/qualify/u)
  assert.match(publishAction, /uses: \$\/\.github\/actions\/publish\/packages/u)
  assert.match(publishAction, /tarballs-json: \$\{\{ steps\.domains\.outputs\.tarballs \}\}/u)
})
