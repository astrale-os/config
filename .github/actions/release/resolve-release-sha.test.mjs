import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolveReleaseSha } from './resolve-release-sha.mjs'

const revision = '0123456789abcdef0123456789abcdef01234567'
const laterMainRevision = 'abcdef0123456789abcdef0123456789abcdef01'
const resolver = fileURLToPath(new URL('./resolve-release-sha.mjs', import.meta.url))

describe('Release Please revision resolution', () => {
  test('resolves one path release', () => {
    assert.equal(
      resolveReleaseSha('["protocol"]', JSON.stringify({ 'protocol--sha': revision })),
      revision,
    )
  })

  test('requires every released path to share the same revision', () => {
    assert.equal(
      resolveReleaseSha(
        '["protocol","server","client"]',
        JSON.stringify({
          'protocol--sha': revision,
          'server--sha': revision,
          'client--sha': revision,
          'unreleased--sha': laterMainRevision,
        }),
      ),
      revision,
    )
    assert.throws(
      () =>
        resolveReleaseSha(
          '["client","server"]',
          JSON.stringify({
            'client--sha': revision,
            'server--sha': 'abcdef0123456789abcdef0123456789abcdef01',
          }),
        ),
      /share one exact commit SHA/u,
    )
  })

  test('uses the unprefixed output for a root component', () => {
    assert.equal(resolveReleaseSha('["."]', JSON.stringify({ sha: revision })), revision)
    assert.equal(
      resolveReleaseSha(
        '[".","packages/typescript"]',
        JSON.stringify({ sha: revision, 'packages/typescript--sha': revision }),
      ),
      revision,
    )
  })

  test('rejects missing and malformed revisions', () => {
    assert.throws(() => resolveReleaseSha('["client"]', '{}'), /client--sha/u)
    assert.throws(
      () => resolveReleaseSha('["client"]', JSON.stringify({ 'client--sha': 'main' })),
      /exact commit SHA/u,
    )
  })

  test('rejects malformed Release Please documents', () => {
    assert.throws(() => resolveReleaseSha('not-json', '{}'), /valid JSON/u)
    assert.throws(() => resolveReleaseSha('[]', '{}'), /non-empty JSON array/u)
    assert.throws(() => resolveReleaseSha('["client"]', '[]'), /JSON object/u)
  })
})

test('the executable emits the released tag revision instead of the triggering workflow revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'astrale-release-sha-'))
  const output = join(directory, 'github-output')
  try {
    const result = spawnSync(process.execPath, [resolver], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_SHA: laterMainRevision,
        PATHS_RELEASED: '["protocol","client"]',
        RELEASE_OUTPUTS: JSON.stringify({
          'protocol--sha': revision,
          'client--sha': revision,
        }),
      },
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(output, 'utf8'), `sha=${revision}\n`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the executable fails without appending a partial release revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'astrale-release-sha-'))
  const output = join(directory, 'github-output')
  try {
    writeFileSync(output, 'retained=true\n', 'utf8')
    const result = spawnSync(process.execPath, [resolver], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        PATHS_RELEASED: '["protocol","client"]',
        RELEASE_OUTPUTS: JSON.stringify({
          'protocol--sha': revision,
          'client--sha': laterMainRevision,
        }),
      },
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /share one exact commit SHA/u)
    assert.equal(readFileSync(output, 'utf8'), 'retained=true\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the composite action exposes only the resolver output as release_sha', async () => {
  const source = await readFile(new URL('./action.yml', import.meta.url), 'utf8')
  const output = source.match(/  release_sha:\n(?:    .+\n){2}/u)?.[0]
  const stepStart = source.indexOf('    - name: Resolve exact released revision')
  const nextStep = source.indexOf('\n    - name:', stepStart + 1)
  const step =
    stepStart === -1 ? '' : source.slice(stepStart, nextStep === -1 ? source.length : nextStep)

  assert.match(output ?? '', /value: \$\{\{ steps\.release-revision\.outputs\.sha \}\}/u)
  assert.match(step, /if: steps\.release\.outputs\.releases_created == 'true'/u)
  assert.match(step, /RELEASE_OUTPUTS: \$\{\{ toJSON\(steps\.release\.outputs\) \}\}/u)
  assert.match(step, /PATHS_RELEASED: \$\{\{ steps\.release\.outputs\.paths_released \}\}/u)
  assert.match(step, /run: node "\$\{\{ github\.action_path \}\}\/resolve-release-sha\.mjs"/u)
  assert.doesNotMatch(`${output ?? ''}\n${step}`, /github\.sha/u)
})
