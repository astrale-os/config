import { ManifestPlugin } from 'release-please/build/src/plugin.js'
import { PullRequestBody } from 'release-please/build/src/util/pull-request-body.js'
import { TagName } from 'release-please/build/src/util/tag-name.js'

// Capture the actual Conventional Commits passed to each strategy, including plugin transforms.
class ReleaseInputs extends ManifestPlugin {
  commits = new Map()
  packages = new Map()
  paths = new Map()

  async preconfigure(strategies, _commits, latestReleases) {
    this.latestReleases = latestReleases
    for (const [path, strategy] of Object.entries(strategies)) {
      this.paths.set(await strategy.getComponent(), path)
      const build = strategy.buildReleasePullRequest.bind(strategy)
      strategy.buildReleasePullRequest = async (commits, ...args) => {
        const candidate = await build(commits, ...args)
        if (candidate) this.commits.set(path, commits)
        return candidate
      }
    }
    return strategies
  }

  async readPackage(path, candidate) {
    if (!this.packages.has(path)) {
      const file = path === '.' ? 'package.json' : `${path}/package.json`
      // Use the exact source snapshot consumed by the native package updater.
      const contents =
        candidate.updates.find(({ path }) => path === file)?.cachedFileContents ||
        (await this.github.getFileContentsOnBranch(file, this.targetBranch))
      const { parsedContent } = contents
      this.packages.set(path, JSON.parse(parsedContent))
    }
    return this.packages.get(path)
  }

  async describe(candidates) {
    const releases = []
    for (const candidate of candidates) {
      for (const datum of candidate.body.releaseData) {
        const path = this.paths.get(datum.component || '')
        if (path === undefined) throw new Error(`No release path for component ${datum.component}.`)
        const config = this.repositoryConfig[path]
        const original =
          config.releaseType === 'node' ? await this.readPackage(path, candidate) : undefined
        const previousTag = this.latestReleases[path]?.tag
        const currentTag = new TagName(
          datum.version,
          datum.component,
          config.tagSeparator,
          config.includeVInTag,
        )
        releases.push({
          candidate,
          original,
          data: {
            path,
            component: datum.component,
            name: original?.name,
            version: datum.version.toString(),
            previousVersion: previousTag?.version.toString(),
            previousTag: previousTag?.toString(),
            currentTag: currentTag.toString(),
            commits: this.commits.get(path) || [],
            changelogSections: config.changelogSections,
            dependencies: [],
          },
        })
      }
    }
    const versions = new Map(
      releases
        .filter(({ original }) => original)
        .map(({ original, data }) => [original.name, data.version]),
    )
    for (const { candidate, original, data } of releases) {
      if (!original) continue
      const file = data.path === '.' ? 'package.json' : `${data.path}/package.json`
      const update = candidate.updates.find(({ path }) => path === file)
      const updated = update
        ? JSON.parse(update.updater.updateContent(JSON.stringify(original)))
        : original
      for (const type of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ]) {
        for (const [name, from] of Object.entries(original[type] || {})) {
          const to = from.startsWith('workspace:') ? versions.get(name) : updated[type]?.[name]
          if (to !== undefined && to !== from) data.dependencies.push({ type, name, from, to })
        }
      }
    }
    return releases
  }
}

function identities(body) {
  return body.releaseData
    .map(({ component, version }) => JSON.stringify([component || '', version?.toString()]))
    .sort()
}

export function installRenderer(
  manifest,
  render,
  { date = new Date().toISOString().slice(0, 10), host = 'https://github.com' } = {},
) {
  const inputs = new ReleaseInputs(
    manifest.github,
    manifest.targetBranch,
    manifest.repositoryConfig,
  )
  manifest.plugins.push(inputs)
  const build = manifest.buildPullRequests.bind(manifest)
  // createPullRequests uses this public method before it performs any PR writes.
  manifest.buildPullRequests = async () => {
    const candidates = await build()
    const releases = await inputs.describe(candidates)
    const rendered = []
    for (const candidate of candidates) {
      const markdown = await render({
        releases: releases
          .filter((release) => release.candidate === candidate)
          .map(({ data }) => data),
        repository: `${manifest.github.repository.owner}/${manifest.github.repository.repo}`,
        targetBranch: manifest.targetBranch,
        host,
        date,
      })
      if (typeof markdown !== 'string')
        throw new TypeError('The release renderer must return Markdown as a string.')
      const parsed = PullRequestBody.parse(markdown)
      if (
        !parsed ||
        JSON.stringify(identities(parsed)) !== JSON.stringify(identities(candidate.body))
      ) {
        throw new TypeError('The rendered body must preserve every release component and version.')
      }
      // Use the native body serializer: Release Please normalizes existing bodies the same way
      // before comparing them. Retaining a raw string would cause a write on every invocation.
      rendered.push(parsed)
    }
    candidates.forEach((candidate, index) => {
      candidate.body = rendered[index]
    })
    return candidates
  }
}
