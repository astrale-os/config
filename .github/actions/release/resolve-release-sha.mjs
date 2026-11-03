import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const commitPattern = /^[0-9a-f]{40}$/u

function parseJson(value, name) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new TypeError(`${name} must be valid JSON.`, { cause: error })
  }
}

function outputKey(path, name) {
  return path === '.' ? name : `${path}--${name}`
}

/**
 * Resolves every release created by one Release Please invocation to its own exact tag revision.
 *
 * Release Please creates one release per merged release PR. When several release PRs merge before
 * a single run (GitHub keeps only the newest pending run of a concurrency group), each release
 * carries the merge SHA of its own PR. `releases` lists them in `PATHS_RELEASED` order; `sha` is
 * set only when every release shares one revision.
 */
export function resolveReleaseRevisions(pathsJson, outputsJson, { requireShared = true } = {}) {
  const paths = parseJson(pathsJson, 'PATHS_RELEASED')
  const outputs = parseJson(outputsJson, 'RELEASE_OUTPUTS')
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((path) => typeof path === 'string' && path.length > 0)
  ) {
    throw new TypeError('PATHS_RELEASED must be a non-empty JSON array of strings.')
  }
  if (new Set(paths).size !== paths.length) {
    throw new TypeError('PATHS_RELEASED must not repeat a path.')
  }
  if (outputs === null || typeof outputs !== 'object' || Array.isArray(outputs)) {
    throw new TypeError('RELEASE_OUTPUTS must be a JSON object.')
  }

  const releases = paths.map((path) => {
    const shaKey = outputKey(path, 'sha')
    const sha = outputs[shaKey]
    if (typeof sha !== 'string' || !commitPattern.test(sha)) {
      throw new TypeError(`Release Please output ${shaKey} must be an exact commit SHA.`)
    }
    const tagKey = outputKey(path, 'tag_name')
    const tag = outputs[tagKey]
    if (typeof tag !== 'string' || tag.length === 0) {
      throw new TypeError(`Release Please output ${tagKey} must be the created release tag.`)
    }
    return { path, sha, tag }
  })

  const revisions = new Set(releases.map(({ sha }) => sha))
  if (revisions.size !== 1 && requireShared) {
    throw new TypeError(
      'Every release created in one invocation must share one exact commit SHA. ' +
        "Set require-shared-release-sha: 'false' and publish each entry of the releases output " +
        'at its own sha instead.',
    )
  }
  return { sha: revisions.size === 1 ? [...revisions][0] : undefined, releases }
}

export function resolveReleaseSha(pathsJson, outputsJson) {
  return resolveReleaseRevisions(pathsJson, outputsJson).sha
}

function parseRequireShared(value) {
  if (value === undefined || value === '' || value === 'true') return true
  if (value === 'false') return false
  throw new TypeError("REQUIRE_SHARED_RELEASE_SHA must be 'true' or 'false'.")
}

function main() {
  const output = process.env.GITHUB_OUTPUT
  if (typeof output !== 'string' || output.length === 0) {
    throw new TypeError('GITHUB_OUTPUT is required.')
  }
  const { sha, releases } = resolveReleaseRevisions(
    process.env.PATHS_RELEASED ?? '',
    process.env.RELEASE_OUTPUTS ?? '',
    { requireShared: parseRequireShared(process.env.REQUIRE_SHARED_RELEASE_SHA) },
  )
  const lines = [`releases=${JSON.stringify(releases)}`]
  if (sha !== undefined) lines.unshift(`sha=${sha}`)
  appendFileSync(output, `${lines.join('\n')}\n`, 'utf8')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
