import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GitHub, Manifest } from 'release-please'

import { installRenderer } from './render.mjs'

export function releaseOutputs(releases, prs) {
  const outputs = {
    releases_created: releases.length > 0,
    paths_released: JSON.stringify(releases.map(({ path }) => path || '.')),
    prs_created: prs.length > 0,
  }
  for (const release of releases) {
    const path = release.path || '.'
    const prefix = path === '.' ? '' : `${path}--`
    outputs[`${prefix}release_created`] = true
    for (const [key, value] of Object.entries(release)) {
      const outputKey =
        { tagName: 'tag_name', uploadUrl: 'upload_url', notes: 'body', url: 'html_url' }[key] || key
      outputs[`${prefix}${outputKey}`] = value
    }
  }
  if (prs.length) {
    outputs.pr = prs[0]
    outputs.prs = JSON.stringify(prs)
  }
  return outputs
}

export async function runRelease({ createManifest, render, host }) {
  const releaseManifest = await createManifest()
  const releases = (await releaseManifest.createReleases()).filter(Boolean)
  const prManifest = await createManifest()
  installRenderer(prManifest, render, { host })
  const prs = (await prManifest.createPullRequests()).filter(Boolean)
  return releaseOutputs(releases, prs)
}

export function writeOutputs(file, outputs) {
  const delimiter = `release_${randomUUID()}`
  const lines = Object.entries(outputs).map(([key, value]) => {
    const content = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    return `${key}<<${delimiter}\n${content}\n${delimiter}\n`
  })
  appendFileSync(file, lines.join(''))
}

async function main() {
  const {
    RELEASE_TOKEN,
    RELEASE_RENDERER,
    GITHUB_WORKSPACE,
    GITHUB_REPOSITORY,
    RELEASE_TARGET_BRANCH,
    GITHUB_OUTPUT,
  } = process.env
  if (!RELEASE_TOKEN || !RELEASE_RENDERER || !GITHUB_REPOSITORY || !GITHUB_OUTPUT) {
    throw new TypeError('Release token, renderer, repository, and GitHub output are required.')
  }
  const { default: render } = await import(
    pathToFileURL(resolve(GITHUB_WORKSPACE || '.', RELEASE_RENDERER)).href
  )
  if (typeof render !== 'function')
    throw new TypeError('The release renderer must export a default function.')
  const [owner, repo] = GITHUB_REPOSITORY.split('/')
  const github = await GitHub.create({
    owner,
    repo,
    token: RELEASE_TOKEN,
    defaultBranch: RELEASE_TARGET_BRANCH,
    apiUrl: process.env.GITHUB_API_URL,
    graphqlUrl: process.env.GITHUB_GRAPHQL_URL?.replace(/\/graphql$/, ''),
  })
  const outputs = await runRelease({
    createManifest: () =>
      Manifest.fromManifest(
        github,
        github.repository.defaultBranch,
        process.env.RELEASE_CONFIG_FILE,
        process.env.RELEASE_MANIFEST_FILE,
      ),
    render,
    host: process.env.GITHUB_SERVER_URL || 'https://github.com',
  })
  writeOutputs(GITHUB_OUTPUT, outputs)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
