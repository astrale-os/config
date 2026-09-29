import assert from 'node:assert/strict'
import test from 'node:test'
import { Manifest, setLogger } from 'release-please'
import { Node } from 'release-please/build/src/strategies/node.js'
import { PullRequestBody } from 'release-please/build/src/util/pull-request-body.js'
import { Version } from 'release-please/build/src/version.js'

import { installRenderer } from './render.mjs'
import { runRelease } from './run.mjs'

setLogger(
  Object.fromEntries(
    ['trace', 'debug', 'info', 'warn', 'error'].map((method) => [method, () => {}]),
  ),
)
const sha = 'a'.repeat(40)
const oldSha = 'b'.repeat(40)

function fixture(options = {}) {
  const packages = {
    core: { name: '@example/core', version: '1.0.0' },
    client: {
      name: '@example/client',
      version: '1.0.0',
      dependencies: { '@example/core': 'workspace:*', external: '^4.0.0' },
      devDependencies: { '@example/core': 'workspace:^' },
      peerDependencies: { '@example/core': '^1.0.0' },
      optionalDependencies: { '@example/core': '~1.0.0' },
    },
  }
  const writes = []
  let existing
  const github = {
    repository: { owner: 'owner', repo: 'repo', defaultBranch: 'main' },
    async getFileContentsOnBranch(file) {
      const pkg = packages[file.split('/')[0]]
      assert.ok(pkg, `unexpected file: ${file}`)
      return { parsedContent: JSON.stringify(pkg) }
    },
    async *releaseIterator() {
      for (const path of Object.keys(packages)) yield { tagName: `${path}-v1.0.0`, sha: oldSha }
    },
    async *mergeCommitIterator() {
      yield { sha, message: 'fix(core): repair state (#12)', files: ['core/index.ts'] }
      yield {
        sha: oldSha,
        message: 'chore: release',
        files: ['core/package.json', 'client/package.json'],
      }
    },
    async *pullRequestIterator(_branch, state) {
      if (state === 'OPEN' && existing) yield existing
    },
    async createPullRequest(pr, _branch, _message, updates) {
      writes.push({ pr, updates })
      existing = { ...pr, number: 42, baseBranchName: 'main' }
      return existing
    },
    async updatePullRequest() {
      throw new Error('Unexpected PR update')
    },
  }
  const createManifest = () =>
    new Manifest(
      github,
      'main',
      {
        core: { releaseType: 'node' },
        client: { releaseType: 'node' },
      },
      { core: Version.parse('1.0.0'), client: Version.parse('1.0.0') },
      { plugins: ['node-workspace'], ...options },
    )
  return { createManifest, packages, writes, github }
}

function render({ releases }) {
  return `Release preview\n---\n\n${releases
    .map(
      ({ component, version, dependencies, commits }) =>
        `<details><summary>${component ? `${component}: ` : ''}${version}</summary>\n\n## ${version}\n\n${commits.map(({ bareMessage }) => `* ${bareMessage}`).join('\n')}\n\n${dependencies.map(({ name, to }) => `${name} → ${to}`).join(', ')}\n</details>`,
    )
    .join('\n\n')}\n\n---\nGenerated release`
}

test('native workspace generation delivers structured commits and all dependency kinds before the first PR write', async () => {
  const { createManifest, writes, github } = fixture({
    plugins: [{ type: 'node-workspace', updatePeerDependencies: true }],
  })
  const contexts = []
  const manifest = createManifest()
  installRenderer(
    manifest,
    async (context) => {
      assert.equal(writes.length, 0)
      contexts.push(context)
      return render(context)
    },
    { date: '2026-09-29' },
  )
  const [pr] = await manifest.createPullRequests()
  assert.equal(writes.length, 1)
  assert.equal(pr.body, PullRequestBody.parse(render(contexts[0])).toString())
  assert.equal(contexts[0].repository, 'owner/repo')
  assert.equal(contexts[0].date, '2026-09-29')
  const core = contexts[0].releases.find(({ path }) => path === 'core')
  assert.equal(core.version, '1.0.1')
  assert.equal(core.commits[0].type, 'fix')
  assert.equal(core.commits[0].scope, 'core')
  assert.equal(core.commits[0].sha, sha)
  const client = contexts[0].releases.find(({ path }) => path === 'client')
  assert.deepEqual(client.commits, [])
  assert.deepEqual(client.dependencies, [
    { type: 'dependencies', name: '@example/core', from: 'workspace:*', to: '1.0.1' },
    { type: 'devDependencies', name: '@example/core', from: 'workspace:^', to: '1.0.1' },
    { type: 'peerDependencies', name: '@example/core', from: '^1.0.0', to: '^1.0.1' },
    { type: 'optionalDependencies', name: '@example/core', from: '~1.0.0', to: '~1.0.1' },
  ])
  assert.deepEqual(
    PullRequestBody.parse(pr.body).releaseData.map(({ component, version }) => [
      component,
      version.toString(),
    ]),
    [
      ['client', '1.0.1'],
      ['core', '1.0.1'],
    ],
  )
  const updates = writes[0].updates
  const coreUpdate = updates.find(({ path }) => path === 'core/package.json')
  assert.equal(
    JSON.parse(coreUpdate.updater.updateContent('{"name":"@example/core","version":"1.0.0"}'))
      .version,
    '1.0.1',
  )
  const changelog = updates
    .find(({ path }) => path === 'core/CHANGELOG.md')
    .updater.updateContent('')
  assert.match(changelog, /### Bug Fixes/)
  assert.doesNotMatch(changelog, /Release preview/)
  const strategy = new Node({ github, path: 'core', component: 'core', targetBranch: 'main' })
  const published = await strategy.buildRelease({ ...pr, sha, mergeCommitOid: sha })
  assert.equal(published.tag.toString(), 'core-v1.0.1')
  assert.equal(published.sha, sha)
  assert.match(published.notes, /repair state \(#12\)/)

  // A fresh invocation compares the generated body to the existing PR and performs no write.
  const next = createManifest()
  installRenderer(next, render, { date: '2026-09-29' })
  assert.deepEqual(await next.createPullRequests(), [])
  assert.equal(writes.length, 1)
})

test('invalid rendering cannot create a PR or change the release inventory', async () => {
  for (const invalid of [
    () => undefined,
    () => 'plain text',
    (context) => render(context).replace('client: 1.0.1', 'client: 9.0.0'),
    (context) => render({ ...context, releases: context.releases.slice(1) }),
    () => {
      throw new Error('render failed')
    },
  ]) {
    const { createManifest, writes } = fixture()
    const manifest = createManifest()
    installRenderer(manifest, invalid)
    await assert.rejects(manifest.createPullRequests())
    assert.deepEqual(writes, [])
  }
})

test('disabled peer updates remain absent and separate PRs are all rendered before any write', async () => {
  const { createManifest, writes } = fixture({
    plugins: [{ type: 'node-workspace', merge: false }],
    separatePullRequests: true,
  })
  let renders = 0
  const manifest = createManifest()
  installRenderer(manifest, (context) => {
    assert.equal(writes.length, 0)
    assert.equal(context.releases.length, 1)
    assert.ok(
      context.releases.every(({ dependencies }) =>
        dependencies.every(({ type }) => type !== 'peerDependencies'),
      ),
    )
    renders += 1
    if (renders === 2) throw new Error('second renderer failed')
    return render(context)
  })
  await assert.rejects(manifest.createPullRequests(), /second renderer failed/)
  assert.equal(renders, 2)
  assert.deepEqual(writes, [])
})

test('a renderer may reorder packages while preserving their exact identities', async () => {
  const { createManifest } = fixture()
  const manifest = createManifest()
  installRenderer(manifest, (context) =>
    render({ ...context, releases: [...context.releases].reverse() }),
  )
  const [candidate] = await manifest.buildPullRequests()
  assert.deepEqual(
    candidate.body.releaseData.map(({ component }) => component),
    ['core', 'client'],
  )
})

test('the runner uses native release and PR lifecycles with the renderer installed', async () => {
  const { createManifest, writes } = fixture()
  const outputs = await runRelease({ createManifest, render })
  assert.equal(outputs.releases_created, false)
  assert.equal(outputs.prs_created, true)
  assert.equal(outputs.pr.number, 42)
  assert.deepEqual(JSON.parse(outputs.prs), [outputs.pr])
  assert.equal(writes.length, 1)
  assert.match(outputs.pr.body, /^Release preview\n/)
})

test('a root package without a component tag can be rendered and published', async () => {
  const { github, packages } = fixture()
  const read = github.getFileContentsOnBranch
  github.getFileContentsOnBranch = (file) =>
    read(file === 'package.json' ? 'core/package.json' : file)
  github.releaseIterator = async function* () {
    yield { tagName: 'v1.0.0', sha: oldSha }
  }
  const manifest = new Manifest(
    github,
    'main',
    { '.': { releaseType: 'node', includeComponentInTag: false } },
    { '.': Version.parse('1.0.0') },
  )
  installRenderer(manifest, (context) => {
    assert.equal(context.releases[0].path, '.')
    assert.equal(context.releases[0].name, packages.core.name)
    return render(context)
  })
  const [pr] = await manifest.createPullRequests()
  const strategy = new Node({ github, targetBranch: 'main', includeComponentInTag: false })
  const release = await strategy.buildRelease({ ...pr, sha, mergeCommitOid: sha })
  assert.equal(release.tag.toString(), 'v1.0.1')
  assert.match(release.notes, /repair state \(#12\)/)
})
