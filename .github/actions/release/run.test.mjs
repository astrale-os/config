import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { resolveReleaseSha } from './resolve-release-sha.mjs'
import { releaseOutputs, runRelease, writeOutputs } from './run.mjs'

const sha = 'a'.repeat(40)

test('release outputs preserve named/root fields, renamed action keys, and exact revision resolution', () => {
  const releases = [
    {
      path: 'core',
      version: '1.2.3',
      sha,
      tagName: 'core-v1.2.3',
      notes: 'Line one\nLine two',
      url: 'https://github.com/release',
      uploadUrl: 'https://github.com/upload',
    },
    { path: '.', version: '2.0.0', sha, tagName: 'v2.0.0' },
  ]
  const prs = [{ number: 42, headBranchName: 'release-main', body: 'rendered' }]
  const outputs = releaseOutputs(releases, prs)
  assert.equal(outputs.releases_created, true)
  assert.equal(outputs['core--tag_name'], 'core-v1.2.3')
  assert.equal(outputs['core--body'], 'Line one\nLine two')
  assert.equal(outputs['core--html_url'], releases[0].url)
  assert.equal(outputs['core--upload_url'], releases[0].uploadUrl)
  assert.equal(outputs.release_created, true)
  assert.equal(outputs.tag_name, 'v2.0.0')
  assert.equal(resolveReleaseSha(outputs.paths_released, JSON.stringify(outputs)), sha)
  assert.deepEqual(outputs.pr, prs[0])
  assert.deepEqual(JSON.parse(outputs.prs), prs)
  assert.deepEqual(releaseOutputs([], []), {
    releases_created: false,
    paths_released: '[]',
    prs_created: false,
  })
})

test('runner loads separate manifests in the upstream release-then-PR order and filters no-op results', async () => {
  const events = []
  let count = 0
  const outputs = await runRelease({
    createManifest: async () => {
      count += 1
      events.push(`manifest ${count}`)
      if (count === 1)
        return {
          async createReleases() {
            events.push('publish')
            return [undefined, { path: 'core', sha, version: '1.2.3' }]
          },
        }
      return {
        github: {},
        targetBranch: 'main',
        repositoryConfig: {},
        plugins: [],
        buildPullRequests() {},
        async createPullRequests() {
          events.push('PR')
          return [undefined]
        },
      }
    },
    render: () => {
      throw new Error('No candidates should be rendered')
    },
  })
  assert.deepEqual(events, ['manifest 1', 'publish', 'manifest 2', 'PR'])
  assert.equal(outputs.releases_created, true)
  assert.equal(outputs.prs_created, false)
})

test('GitHub output encoding preserves arbitrary multiline Markdown and JSON PR values', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'release-output-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'outputs')
  const values = {
    body: 'first\nEOF\n---\nlast\n',
    pr: { number: 42, body: 'first\nlast' },
    prs_created: false,
    optional: undefined,
    nullable: null,
  }
  writeOutputs(file, values)
  const lines = (await readFile(file, 'utf8')).split('\n')
  const parsed = {}
  for (let index = 0; index < lines.length - 1;) {
    const [key, delimiter] = lines[index++].split('<<')
    const content = []
    while (lines[index] !== delimiter) content.push(lines[index++])
    index += 1
    parsed[key] = content.join('\n')
  }
  assert.equal(parsed.body, values.body)
  assert.deepEqual(JSON.parse(parsed.pr), values.pr)
  assert.equal(parsed.prs_created, 'false')
  assert.equal(parsed.optional, '')
  assert.equal(parsed.nullable, '')
})

test('the action selects a single implementation and installs only its locked runtime', async () => {
  const source = await readFile(new URL('./action.yml', import.meta.url), 'utf8')
  assert.match(source, /id: release\n\s+if: inputs\.renderer == ''/)
  assert.match(source, /id: render\n\s+if: inputs\.renderer != ''/)
  assert.match(source, /npm ci --prefix "\$\{\{ github.action_path \}\}" --ignore-scripts/)
  assert.doesNotMatch(source, /rewrite|GH_TOKEN/)
  for (const key of ['releases_created', 'paths_released', 'prs_created', 'pr', 'prs']) {
    assert.ok(
      source.includes(
        `value: \u0024{{ steps.render.outputs.${key} || steps.release.outputs.${key} }}`,
      ),
    )
  }
})
