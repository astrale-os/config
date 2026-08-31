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

export function resolveReleaseSha(pathsJson, outputsJson) {
  const paths = parseJson(pathsJson, 'PATHS_RELEASED')
  const outputs = parseJson(outputsJson, 'RELEASE_OUTPUTS')
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((path) => typeof path === 'string')
  ) {
    throw new TypeError('PATHS_RELEASED must be a non-empty JSON array of strings.')
  }
  if (outputs === null || typeof outputs !== 'object' || Array.isArray(outputs)) {
    throw new TypeError('RELEASE_OUTPUTS must be a JSON object.')
  }

  const revisions = new Set(
    paths.map((path) => {
      const key = path === '.' ? 'sha' : `${path}--sha`
      const revision = outputs[key]
      if (typeof revision !== 'string' || !commitPattern.test(revision)) {
        throw new TypeError(`Release Please output ${key} must be an exact commit SHA.`)
      }
      return revision
    }),
  )
  if (revisions.size !== 1) {
    throw new TypeError('Every release created in one invocation must share one exact commit SHA.')
  }
  return [...revisions][0]
}

function main() {
  const output = process.env.GITHUB_OUTPUT
  if (typeof output !== 'string' || output.length === 0) {
    throw new TypeError('GITHUB_OUTPUT is required.')
  }
  const revision = resolveReleaseSha(
    process.env.PATHS_RELEASED ?? '',
    process.env.RELEASE_OUTPUTS ?? '',
  )
  appendFileSync(output, `sha=${revision}\n`, 'utf8')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
