import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolveReleaseRevisions, resolveReleaseSha } from './resolve-release-sha.mjs'

const revision = '0123456789abcdef0123456789abcdef01234567'
const laterMainRevision = 'abcdef0123456789abcdef0123456789abcdef01'
const resolver = fileURLToPath(new URL('./resolve-release-sha.mjs', import.meta.url))

// astrale-os/shell run 41677535494 (2026-11-03): two release PRs merged before one Release
// Please run, which then created both releases, each tagged at its own merge commit.
const shellReactSha = '96dbc171' + '0'.repeat(32)
const shellDomainSha = 'ed5ff675' + '0'.repeat(32)
const incidentPaths = '["packages/shell-react","domain"]'
const incidentOutputs = JSON.stringify({
  'packages/shell-react--sha': shellReactSha,
  'packages/shell-react--tag_name': 'shell-react-v0.6.0-beta.11',
  'domain--sha': shellDomainSha,
  'domain--tag_name': 'shell-domain-v0.1.3',
})

function released(entries) {
  return JSON.stringify(
    Object.fromEntries(
      entries.flatMap(([path, sha]) => {
        const prefix = path === '.' ? '' : `${path}--`
        return [
          [`${prefix}sha`, sha],
          [`${prefix}tag_name`, `${path === '.' ? 'root' : path}-v1.0.0`],
        ]
      }),
    ),
  )
}

function runResolver(env) {
  const directory = mkdtempSync(join(tmpdir(), 'astrale-release-sha-'))
  const output = join(directory, 'github-output')
  try {
    writeFileSync(output, 'retained=true\n', 'utf8')
    const result = spawnSync(process.execPath, [resolver], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output, ...env },
    })
    return { ...result, output: readFileSync(output, 'utf8') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('Release Please revision resolution', () => {
  test('resolves one path release', () => {
    assert.equal(resolveReleaseSha('["protocol"]', released([['protocol', revision]])), revision)
  })

  test('requires every released path to share the same revision by default', () => {
    assert.equal(
      resolveReleaseSha(
        '["protocol","server","client"]',
        JSON.stringify({
          ...JSON.parse(
            released([
              ['protocol', revision],
              ['server', revision],
              ['client', revision],
            ]),
          ),
          'unreleased--sha': laterMainRevision,
        }),
      ),
      revision,
    )
    assert.throws(
      () =>
        resolveReleaseSha(
          '["client","server"]',
          released([
            ['client', revision],
            ['server', laterMainRevision],
          ]),
        ),
      /share one exact commit SHA/u,
    )
    assert.throws(() => resolveReleaseRevisions(incidentPaths, incidentOutputs), /share one/u)
  })

  test('uses the unprefixed outputs for a root component', () => {
    assert.equal(resolveReleaseSha('["."]', released([['.', revision]])), revision)
    assert.deepEqual(
      resolveReleaseRevisions(
        '[".","packages/typescript"]',
        released([
          ['.', revision],
          ['packages/typescript', revision],
        ]),
      ),
      {
        sha: revision,
        releases: [
          { path: '.', sha: revision, tag: 'root-v1.0.0' },
          { path: 'packages/typescript', sha: revision, tag: 'packages/typescript-v1.0.0' },
        ],
      },
    )
  })

  test('lists each release at its own revision when a shared revision is not required', () => {
    assert.deepEqual(
      resolveReleaseRevisions(incidentPaths, incidentOutputs, { requireShared: false }),
      {
        sha: undefined,
        releases: [
          { path: 'packages/shell-react', sha: shellReactSha, tag: 'shell-react-v0.6.0-beta.11' },
          { path: 'domain', sha: shellDomainSha, tag: 'shell-domain-v0.1.3' },
        ],
      },
    )
  })

  test('still exposes the shared revision when it is not required', () => {
    const { sha, releases } = resolveReleaseRevisions(
      '["packages/shell","packages/shell-react"]',
      released([
        ['packages/shell', revision],
        ['packages/shell-react', revision],
      ]),
      { requireShared: false },
    )
    assert.equal(sha, revision)
    assert.deepEqual(
      releases.map(({ path }) => path),
      ['packages/shell', 'packages/shell-react'],
    )
  })

  test('rejects missing and malformed revisions and tags in every mode', () => {
    for (const requireShared of [true, false]) {
      assert.throws(
        () => resolveReleaseRevisions('["client"]', '{}', { requireShared }),
        /client--sha/u,
      )
      assert.throws(
        () =>
          resolveReleaseRevisions(
            '["client"]',
            JSON.stringify({ 'client--sha': 'main', 'client--tag_name': 'client-v1.0.0' }),
            { requireShared },
          ),
        /exact commit SHA/u,
      )
      assert.throws(
        () =>
          resolveReleaseRevisions(
            '["client","server"]',
            JSON.stringify({
              ...JSON.parse(released([['client', revision]])),
              'server--sha': laterMainRevision.toUpperCase(),
              'server--tag_name': 'server-v1.0.0',
            }),
            { requireShared },
          ),
        /server--sha must be an exact commit SHA/u,
      )
      assert.throws(
        () =>
          resolveReleaseRevisions('["client"]', JSON.stringify({ 'client--sha': revision }), {
            requireShared,
          }),
        /client--tag_name must be the created release tag/u,
      )
    }
  })

  test('rejects malformed Release Please documents', () => {
    assert.throws(() => resolveReleaseSha('not-json', '{}'), /valid JSON/u)
    assert.throws(() => resolveReleaseSha('[]', '{}'), /non-empty JSON array/u)
    assert.throws(() => resolveReleaseSha('[""]', '{}'), /non-empty JSON array/u)
    assert.throws(() => resolveReleaseSha('["client"]', '[]'), /JSON object/u)
    assert.throws(
      () =>
        resolveReleaseRevisions('["client","client"]', released([['client', revision]]), {
          requireShared: false,
        }),
      /must not repeat a path/u,
    )
  })
})

test('the executable emits the released tag revision instead of the triggering workflow revision', () => {
  const result = runResolver({
    GITHUB_SHA: laterMainRevision,
    PATHS_RELEASED: '["protocol","client"]',
    RELEASE_OUTPUTS: released([
      ['protocol', revision],
      ['client', revision],
    ]),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    result.output,
    `retained=true\nsha=${revision}\nreleases=${JSON.stringify([
      { path: 'protocol', sha: revision, tag: 'protocol-v1.0.0' },
      { path: 'client', sha: revision, tag: 'client-v1.0.0' },
    ])}\n`,
  )
})

test('the executable fails without appending partial outputs when a shared revision is required', () => {
  for (const required of [undefined, 'true']) {
    const result = runResolver({
      PATHS_RELEASED: incidentPaths,
      RELEASE_OUTPUTS: incidentOutputs,
      ...(required === undefined ? {} : { REQUIRE_SHARED_RELEASE_SHA: required }),
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /share one exact commit SHA/u)
    assert.equal(result.output, 'retained=true\n')
  }
})

test('the executable publishes each release at its own revision without a shared one', () => {
  const result = runResolver({
    GITHUB_SHA: laterMainRevision,
    PATHS_RELEASED: incidentPaths,
    RELEASE_OUTPUTS: incidentOutputs,
    REQUIRE_SHARED_RELEASE_SHA: 'false',
  })

  assert.equal(result.status, 0, result.stderr)
  const lines = result.output.trimEnd().split('\n')
  assert.deepEqual(lines.slice(0, 1), ['retained=true'])
  assert.equal(lines.length, 2, 'no sha output is written when the revisions differ')
  assert.deepEqual(JSON.parse(lines[1].replace(/^releases=/u, '')), [
    { path: 'packages/shell-react', sha: shellReactSha, tag: 'shell-react-v0.6.0-beta.11' },
    { path: 'domain', sha: shellDomainSha, tag: 'shell-domain-v0.1.3' },
  ])
})

test('the executable rejects an ambiguous shared-revision setting', () => {
  const result = runResolver({
    PATHS_RELEASED: '["client"]',
    RELEASE_OUTPUTS: released([['client', revision]]),
    REQUIRE_SHARED_RELEASE_SHA: 'no',
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /REQUIRE_SHARED_RELEASE_SHA must be 'true' or 'false'/u)
  assert.equal(result.output, 'retained=true\n')
})

test('the composite action exposes only the resolver outputs as release_sha and releases', async () => {
  const source = await readFile(new URL('./action.yml', import.meta.url), 'utf8')
  const sharedOutput = source.match(/  release_sha:\n(?:    .+\n){2}/u)?.[0]
  const releasesOutput = source.match(/  releases:\n(?:    .+\n){2}/u)?.[0]
  const input = source.match(/  require-shared-release-sha:\n(?:    .+\n|      .+\n)+/u)?.[0]
  const stepStart = source.indexOf('    - name: Resolve exact released revision')
  const nextStep = source.indexOf('\n    - name:', stepStart + 1)
  const step =
    stepStart === -1 ? '' : source.slice(stepStart, nextStep === -1 ? source.length : nextStep)

  assert.match(sharedOutput ?? '', /value: \$\{\{ steps\.release-revision\.outputs\.sha \}\}/u)
  assert.match(
    releasesOutput ?? '',
    /value: \$\{\{ steps\.release-revision\.outputs\.releases \}\}/u,
  )
  assert.match(input ?? '', /default: 'true'/u)
  assert.match(step, /if: steps\.release\.outputs\.releases_created == 'true'/u)
  assert.match(
    step,
    /RELEASE_OUTPUTS: \$\{\{ toJSON\(steps\.render\.outputs\.releases_created != '' && steps\.render\.outputs \|\| steps\.release\.outputs\) \}\}/u,
  )
  assert.match(
    step,
    /PATHS_RELEASED: \$\{\{ steps\.render\.outputs\.paths_released \|\| steps\.release\.outputs\.paths_released \}\}/u,
  )
  assert.match(step, /REQUIRE_SHARED_RELEASE_SHA: \$\{\{ inputs\.require-shared-release-sha \}\}/u)
  assert.match(step, /run: node "\$\{\{ github\.action_path \}\}\/resolve-release-sha\.mjs"/u)
  assert.doesNotMatch(`${sharedOutput ?? ''}\n${releasesOutput ?? ''}\n${step}`, /github\.sha/u)
})
