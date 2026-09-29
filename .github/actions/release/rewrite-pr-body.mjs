import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function rewritePullRequests({ pullRequests, repository, rewrite, github }) {
  const updates = []
  for (const pr of pullRequests) {
    if (!Number.isSafeInteger(pr.number) || pr.number <= 0) {
      throw new TypeError('Release Please must provide a valid PR number.')
    }
    const endpoint = `/repos/${repository}/pulls/${pr.number}`
    const pullRequest = await github(endpoint)
    const body = await rewrite({ body: pullRequest.body, pullRequest, repository })
    if (typeof body !== 'string') throw new TypeError('The PR body rewriter must return a string.')
    updates.push({ endpoint, originalBody: pullRequest.body, pr: { ...pr, body } })
  }
  // Finish rendering every PR before applying any changes.
  for (const { endpoint, originalBody, pr } of updates) {
    if (pr.body !== originalBody) await github(endpoint, { body: pr.body })
  }
  return updates.map(({ pr }) => pr)
}

async function main() {
  const {
    GITHUB_OUTPUT,
    GITHUB_REPOSITORY,
    GITHUB_WORKSPACE,
    RELEASE_PRS,
    REWRITE_PR_BODY,
    GH_TOKEN,
  } = process.env
  if (!GITHUB_OUTPUT || !GITHUB_REPOSITORY || !REWRITE_PR_BODY || !GH_TOKEN) {
    throw new TypeError('GitHub output, repository, token, and body rewriter are required.')
  }
  const pullRequests = JSON.parse(RELEASE_PRS)
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) {
    throw new TypeError('RELEASE_PRS must be a non-empty array.')
  }
  const { default: rewrite } = await import(
    pathToFileURL(resolve(GITHUB_WORKSPACE || '.', REWRITE_PR_BODY)).href
  )
  if (typeof rewrite !== 'function') {
    throw new TypeError('The PR body rewriter must export a default function.')
  }
  const github = async (endpoint, patch) => {
    const response = await fetch(
      `${process.env.GITHUB_API_URL || 'https://api.github.com'}${endpoint}`,
      {
        method: patch === undefined ? 'GET' : 'PATCH',
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: patch === undefined ? undefined : JSON.stringify(patch),
      },
    )
    if (!response.ok)
      throw new Error(
        `GitHub ${patch === undefined ? 'GET' : 'PATCH'} ${endpoint} failed (${response.status}).`,
      )
    return response.json()
  }
  const prs = await rewritePullRequests({
    pullRequests,
    repository: GITHUB_REPOSITORY,
    rewrite,
    github,
  })
  appendFileSync(GITHUB_OUTPUT, `pr=${JSON.stringify(prs[0])}\nprs=${JSON.stringify(prs)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
