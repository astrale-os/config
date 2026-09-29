import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { rewritePullRequests } from './rewrite-pr-body.mjs'

test('rewrites every generated PR using fresh metadata and returns the final body', async () => {
  const calls = []
  const pullRequests = [1, 2].map((number) => ({
    number,
    headBranchName: `release-${number}`,
    body: 'stale',
  }))
  const prs = await rewritePullRequests({
    pullRequests,
    repository: 'astrale-os/example',
    rewrite: async ({ body, pullRequest, repository }) =>
      `${repository} #${pullRequest.number}: ${body}`,
    github: async (endpoint, patch) => {
      calls.push([endpoint, patch])
      return { number: Number(endpoint.split('/').at(-1)), body: 'fresh' }
    },
  })
  assert.deepEqual(
    prs,
    pullRequests.map((pr) => ({ ...pr, body: `astrale-os/example #${pr.number}: fresh` })),
  )
  assert.deepEqual(calls, [
    ['/repos/astrale-os/example/pulls/1', undefined],
    ['/repos/astrale-os/example/pulls/2', undefined],
    ['/repos/astrale-os/example/pulls/1', { body: 'astrale-os/example #1: fresh' }],
    ['/repos/astrale-os/example/pulls/2', { body: 'astrale-os/example #2: fresh' }],
  ])
})

test('unchanged bodies skip writes while outputs still reflect the latest body', async () => {
  const prs = await rewritePullRequests({
    pullRequests: [{ number: 1, body: 'stale' }],
    repository: 'owner/repo',
    rewrite: ({ body }) => body,
    github: async (_endpoint, patch) => {
      assert.equal(patch, undefined)
      return { body: 'current' }
    },
  })
  assert.equal(prs[0].body, 'current')
})

test('invalid hook results and rendering failures do not apply partial rewrites', async () => {
  for (const rewrite of [
    ({ pullRequest }) => (pullRequest.number === 1 ? 'updated' : undefined),
    ({ pullRequest }) => {
      if (pullRequest.number === 2) throw new Error('render failed')
      return 'updated'
    },
  ]) {
    await assert.rejects(
      rewritePullRequests({
        pullRequests: [{ number: 1 }, { number: 2 }],
        repository: 'owner/repo',
        rewrite,
        github: async (endpoint, patch) => {
          assert.equal(patch, undefined)
          return { number: Number(endpoint.split('/').at(-1)), body: 'current' }
        },
      }),
    )
  }
})

test('the executable loads a repository hook, patches GitHub, and exposes consistent action outputs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'release rewrite '))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const modulePath = join(directory, 'rewrite hook.mjs')
  const output = join(directory, 'output')
  await writeFile(
    modulePath,
    'export default async ({ body, repository }) => body.replace("old header", `Release ${repository}`)',
  )
  await writeFile(output, '')
  let body = 'old header\n---\n\n## 1.2.3\n\n* fix\n\n---\nfooter'
  const requests = []
  let rejectPatch = false
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-token')
    assert.equal(req.url, '/repos/owner/repo/pulls/42')
    let content = ''
    for await (const chunk of req) content += chunk
    requests.push([req.method, content])
    if (req.method === 'PATCH') {
      if (rejectPatch) {
        res.writeHead(403).end('{}')
        return
      }
      body = JSON.parse(content).body
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ number: 42, body }))
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const run = () =>
    promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./rewrite-pr-body.mjs', import.meta.url))],
      {
        env: {
          ...process.env,
          GITHUB_WORKSPACE: directory,
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          GH_TOKEN: 'test-token',
          REWRITE_PR_BODY: 'rewrite hook.mjs',
          RELEASE_PRS: JSON.stringify([
            { number: 42, headBranchName: 'release-main', body: 'stale' },
          ]),
        },
      },
    )
  await run()
  const lines = (await readFile(output, 'utf8')).trimEnd().split('\n')
  const pr = JSON.parse(lines[0].slice('pr='.length))
  const prs = JSON.parse(lines[1].slice('prs='.length))
  assert.deepEqual(pr, { number: 42, headBranchName: 'release-main', body })
  assert.deepEqual(prs, [pr])
  assert.match(body, /^Release owner\/repo\n/)
  assert.deepEqual(
    requests.map(([method]) => method),
    ['GET', 'PATCH'],
  )

  await run()
  assert.deepEqual(
    requests.map(([method]) => method),
    ['GET', 'PATCH', 'GET'],
  )
  const retainedOutput = await readFile(output, 'utf8')
  body = body.replace('Release owner/repo', 'old header')
  rejectPatch = true
  await assert.rejects(run(), /failed \(403\)/)
  assert.equal(await readFile(output, 'utf8'), retainedOutput)

  const count = requests.length
  await writeFile(modulePath, 'export default "not a function"')
  await assert.rejects(run(), /default function/)
  assert.equal(requests.length, count)
  assert.equal(await readFile(output, 'utf8'), retainedOutput)
})

test('the action makes rewriting opt-in and forwards final PR outputs', async () => {
  const source = await readFile(new URL('./action.yml', import.meta.url), 'utf8')
  assert.match(
    source,
    /if: inputs\.rewrite-pr-body != '' && steps\.release\.outputs\.prs_created == 'true'/,
  )
  assert.match(source, /RELEASE_PRS: \$\{\{ steps\.release\.outputs\.prs \}\}/)
  for (const output of ['pr', 'prs']) {
    assert.ok(
      source.includes(
        `value: \u0024{{ steps.rewrite.outputs.${output} || steps.release.outputs.${output} }}`,
      ),
    )
  }
})
