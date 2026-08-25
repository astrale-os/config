import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'

import { mirrorPackages, parseDistTags } from './mirror.mjs'

const TOKEN = 'github-packages-test-token'
const REPOSITORY = 'astrale-os/sdk'

test('parses exact dist-tag lines without accepting incidental output', () => {
  assert.deepEqual(
    [...parseDistTags('beta: 1.2.3-beta.4\nnotice not-a-tag\nlatest: 1.2.2\n')],
    [
      ['beta', '1.2.3-beta.4'],
      ['latest', '1.2.2'],
    ],
  )
})

test('mirrors one exact npm tarball, repairs its tag, and proves private repository ownership', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadataMissing.add(candidate.slug)

    await mirrorPackages({
      ...input(root, [candidate.directory], fake.run, request),
      environment: { MIRROR_GITHUB_TOKEN: TOKEN, SAFE_VALUE: 'preserved' },
    })

    assert.equal(fake.publishCalls.length, 1)
    assert.equal(digest(fake.publishCalls[0].bytes), candidate.integrity)
    assert.equal(fake.publishCalls[0].config.mode, 0o600)
    assert.match(
      fake.publishCalls[0].config.contents,
      /@astrale-os:registry=https:\/\/npm\.pkg\.github\.com/u,
    )
    assert.match(fake.publishCalls[0].config.contents, /_authToken=\$\{NODE_AUTH_TOKEN\}/u)
    assert.doesNotMatch(fake.publishCalls[0].config.contents, new RegExp(TOKEN, 'u'))
    assert.equal(fake.publishCalls[0].environment.NODE_AUTH_TOKEN, TOKEN)
    assert.deepEqual(fake.publishCalls[0].args.slice(2), [
      '--access=restricted',
      '--tag',
      'beta',
      '--registry',
      'https://npm.pkg.github.com',
    ])
    assert.deepEqual(fake.tags.github.get(candidate.name), new Map([['beta', candidate.version]]))
    assert.equal(fake.apiCalls.length, 2)
    assert.deepEqual(
      fake.apiCalls.map(({ authorization }) => authorization),
      [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`],
    )
    assert.equal(
      fake.commandEnvironments.every((environment) => environment.SAFE_VALUE === 'preserved'),
      true,
    )
    assert.equal(
      fake.commandEnvironments.every(
        (environment) => environment.MIRROR_GITHUB_TOKEN === undefined,
      ),
      true,
    )
    assert.equal(
      fake.configUses.every(({ contents }) => !contents.includes(TOKEN)),
      true,
    )
    for (const [index, config] of fake.configUses.entries()) {
      assert.equal(
        fake.commandEnvironments[index].NODE_AUTH_TOKEN,
        config.github ? TOKEN : undefined,
      )
      if (config.github) {
        assert.match(
          config.contents,
          /registry=https:\/\/npm\.pkg\.github\.com\/\n@astrale-os:registry=https:\/\/npm\.pkg\.github\.com\//u,
        )
        assert.match(config.contents, /_authToken=\$\{NODE_AUTH_TOKEN\}/u)
      } else {
        assert.match(
          config.contents,
          /registry=https:\/\/registry\.npmjs\.org\/\n@astrale-os:registry=https:\/\/registry\.npmjs\.org\//u,
        )
        assert.doesNotMatch(config.contents, /_authToken/u)
      }
      assert.equal(config.cwd, dirname(config.path))
      assert.notEqual(config.cwd, root)
    }
    assert.equal(
      fake.configUses.every(({ mode }) => mode === 0o600),
      true,
    )
    assert.equal(
      fake.configUses.every(({ path }) => !existsSync(dirname(path))),
      true,
    )
    assert.equal(fake.npmPublicWrites, 0)
  })
})

test('waits for GitHub dist-tags to become readable after the artifact propagates', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadataMissing.add(candidate.slug)
    fake.githubTagLookup404s = 1
    let waits = 0

    await mirrorPackages({
      ...input(root, [candidate.directory], fake.run, request),
      attempts: 2,
      wait: async () => {
        waits += 1
      },
    })

    assert.equal(waits, 1)
    assert.deepEqual(fake.tags.github.get(candidate.name), new Map([['beta', candidate.version]]))
  })
})

test('reports redacted publish evidence when a successful command never materializes', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadataMissing.add(candidate.slug)
    fake.githubPack404s = 1

    await assert.rejects(
      mirrorPackages({
        ...input(root, [candidate.directory], fake.run, request),
        attempts: 1,
      }),
      /not downloadable\. Publish command output: \+ published/u,
    )
  })
})

test('redacts complete publish output before retaining its diagnostic tail', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadataMissing.add(candidate.slug)
    fake.githubPack404s = 1
    fake.publishOutput = `${'x'.repeat(100)}${TOKEN}${'y'.repeat(484)}tail-marker`

    await assert.rejects(
      mirrorPackages({
        ...input(root, [candidate.directory], fake.run, request),
        attempts: 1,
      }),
      (error) => {
        assert.match(error.message, /tail-marker/u)
        assert.doesNotMatch(error.message, new RegExp(TOKEN.slice(-5), 'u'))
        return true
      },
    )
  })
})

test('fails missing credentials and invalid manifests before any registry access', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    await assert.rejects(
      mirrorPackages({ ...input(root, [candidate.directory], fake.run, request), githubToken: '' }),
      /GitHub Packages token is required/u,
    )
    assert.equal(fake.calls.length, 0)
    assert.equal(fake.apiCalls.length, 0)

    const manifest = JSON.parse(
      await readFile(join(root, candidate.directory, 'package.json'), 'utf8'),
    )
    manifest.publishConfig = { access: 'restricted' }
    await writeFile(
      join(root, candidate.directory, 'package.json'),
      `${JSON.stringify(manifest)}\n`,
    )
    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      /not an npm-public package/u,
    )
    assert.equal(fake.calls.length, 0)
    assert.equal(fake.apiCalls.length, 0)

    manifest.publishConfig = {
      access: 'public',
      registry: 'https://npm.pkg.github.com.attacker.example',
    }
    await writeFile(
      join(root, candidate.directory, 'package.json'),
      `${JSON.stringify(manifest)}\n`,
    )
    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      /not an npm-public package/u,
    )
    assert.equal(fake.calls.length, 0)
    assert.equal(fake.apiCalls.length, 0)
  })
})

test('rejects ambient npm credentials before contacting registries', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    for (const name of ['NPM_TOKEN', 'NODE_AUTH_TOKEN']) {
      await assert.rejects(
        mirrorPackages({
          ...input(root, [candidate.directory], fake.run, request),
          environment: { [name]: 'forbidden-token' },
        }),
        /npm token authentication is forbidden/u,
      )
    }
    assert.equal(fake.calls.length, 0)
    assert.equal(fake.apiCalls.length, 0)
  })
})

test('admits every existing package before the first GitHub write', async () => {
  await fixture({ count: 2 }, async ({ root, candidates, fake, request }) => {
    fake.metadata.get(candidates[1].slug).visibility = 'public'

    await assert.rejects(
      mirrorPackages(
        input(
          root,
          candidates.map(({ directory }) => directory),
          fake.run,
          request,
        ),
      ),
      new RegExp(`GitHub package ${candidates[1].name} must remain private`, 'u'),
    )
    assert.deepEqual(
      fake.calls.map((args) => args[0]),
      ['view'],
    )
    assert.equal(fake.publishCalls.length, 0)
    assert.deepEqual(fake.tagAdds, [])
    assert.equal(fake.apiCalls.length, 2)
  })
})

test('rejects an API-hidden existing version during whole-set target preflight', async () => {
  await fixture({ count: 2 }, async ({ root, candidates, fake, request }) => {
    const hidden = candidates[1]
    fake.metadataAlwaysMissing.add(hidden.slug)
    fake.existing.add(hidden.spec)
    fake.targetBytes.set(hidden.spec, hidden.bytes)

    await assert.rejects(
      mirrorPackages(
        input(
          root,
          candidates.map(({ directory }) => directory),
          fake.run,
          request,
        ),
      ),
      new RegExp(`metadata is absent for existing version ${escapeRegExp(hidden.spec)}`, 'u'),
    )
    assert.deepEqual(
      fake.calls.map((args) => args[0]),
      ['view', 'view'],
    )
    assert.equal(fake.publishCalls.length, 0)
    assert.deepEqual(fake.tagAdds, [])
  })
})

test('authenticates the complete npm source set before the first GitHub write', async () => {
  await fixture({ count: 2 }, async ({ root, candidates, fake, request }) => {
    fake.sourceIntegrity.set(candidates[1].name, 'sha512-invalid')

    await assert.rejects(
      mirrorPackages(
        input(
          root,
          candidates.map(({ directory }) => directory),
          fake.run,
          request,
        ),
      ),
      /Downloaded npm tarball integrity disagrees/u,
    )
    assert.equal(fake.publishCalls.length, 0)
    assert.equal(fake.targetReads, 0)
  })
})

test('requires every npm source version to own a release tag before the first write', async () => {
  await fixture({ count: 2 }, async ({ root, candidates, fake, request }) => {
    fake.tags.npm.set(candidates[1].name, new Map([['beta', '0.0.1-beta.1']]))

    await assert.rejects(
      mirrorPackages(
        input(
          root,
          candidates.map(({ directory }) => directory),
          fake.run,
          request,
        ),
      ),
      new RegExp(`npm has no release-channel tag for ${escapeRegExp(candidates[1].spec)}`, 'u'),
    )
    assert.equal(fake.publishCalls.length, 0)
    assert.equal(fake.targetReads, 0)
  })
})

test('copies every exact npm tag and never copies a tag owned by another version', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadataMissing.add(candidate.slug)
    fake.tags.npm.set(
      candidate.name,
      new Map([
        ['beta', candidate.version],
        ['next', candidate.version],
        ['latest', '0.9.0'],
      ]),
    )

    await mirrorPackages(input(root, [candidate.directory], fake.run, request))

    assert.deepEqual(
      fake.tags.github.get(candidate.name),
      new Map([
        ['beta', candidate.version],
        ['next', candidate.version],
      ]),
    )
    assert.deepEqual(fake.tagAdds, [{ spec: candidate.spec, tag: 'next' }])
  })
})

test('treats an identical existing version as idempotent and reconciles only npm-owned tags', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.existing.add(candidate.spec)
    fake.targetBytes.set(candidate.spec, candidate.bytes)
    fake.tags.github.set(
      candidate.name,
      new Map([
        ['beta', '0.0.1-beta.1'],
        ['latest', '0.0.0'],
      ]),
    )

    await mirrorPackages(input(root, [candidate.directory], fake.run, request))

    assert.equal(fake.publishCalls.length, 0)
    assert.deepEqual(fake.tagAdds, [{ spec: candidate.spec, tag: 'beta' }])
    assert.deepEqual(
      fake.tags.github.get(candidate.name),
      new Map([
        ['beta', candidate.version],
        ['latest', '0.0.0'],
      ]),
    )
  })
})

test('rejects mismatched existing content without overwriting or deleting it', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.existing.add(candidate.spec)
    fake.targetBytes.set(candidate.spec, Buffer.from('different artifact'))

    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      /tarball differs from authoritative npm artifact/u,
    )
    assert.equal(fake.publishCalls.length, 0)
    assert.deepEqual(fake.tagAdds, [])
    assert.equal(fake.deleteCalls, 0)
    assert.equal(
      fake.configUses.every(({ path }) => !existsSync(dirname(path))),
      true,
    )
  })
})

test('recovers only a conflict race whose competing artifact is byte-identical', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadataMissing.add(candidate.slug)
    fake.publishConflict.set(candidate.spec, candidate.bytes)

    await mirrorPackages(input(root, [candidate.directory], fake.run, request))

    assert.equal(fake.publishCalls.length, 1)
    assert.equal(fake.existing.has(candidate.spec), true)
  })

  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadataMissing.add(candidate.slug)
    fake.publishConflict.set(candidate.spec, Buffer.from('competing-but-different'))

    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      /tarball differs from authoritative npm artifact/u,
    )
    assert.deepEqual(fake.tagAdds, [])
  })
})

test('waits for a published GitHub tarball and package metadata to propagate', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.githubPack404s = 1
    fake.metadataMissingResponses.set(candidate.slug, 2)
    let waits = 0

    await mirrorPackages({
      ...input(root, [candidate.directory], fake.run, request),
      attempts: 2,
      wait: async () => {
        waits += 1
      },
    })

    assert.equal(waits, 2)
    assert.equal(fake.targetReads, 1)
  })
})

test('rejects a package that becomes public before reconciling secondary tags', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadataMissingResponses.set(candidate.slug, 1)
    fake.metadata.get(candidate.slug).visibility = 'public'
    fake.tags.npm.set(
      candidate.name,
      new Map([
        ['beta', candidate.version],
        ['next', candidate.version],
      ]),
    )

    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      /must remain private/u,
    )
    assert.equal(fake.publishCalls.length, 1)
    assert.deepEqual(fake.tagAdds, [])
  })
})

test('fails an inconclusive GitHub version lookup without publishing', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.lookupFailure = `npm error ${TOKEN} E500`

    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      (error) => {
        assert.match(error.message, /GitHub Packages lookup failed/u)
        assert.doesNotMatch(error.message, new RegExp(TOKEN, 'u'))
        assert.match(error.message, /\[REDACTED\]/u)
        return true
      },
    )
    assert.equal(fake.publishCalls.length, 0)
  })
})

test('redacts the token before truncating registry errors', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.lookupFailure = `${'x'.repeat(495)}${TOKEN} trailing error`

    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      (error) => {
        assert.doesNotMatch(error.message, new RegExp(TOKEN.slice(0, 5), 'u'))
        return true
      },
    )
  })
})

test('leaves a partial secondary mirror retryable without touching npm', async () => {
  await fixture({ count: 3 }, async ({ root, candidates, fake, request }) => {
    fake.publishFailure = candidates[1].spec
    const dirs = candidates.map(({ directory }) => directory)

    await assert.rejects(
      mirrorPackages(input(root, dirs, fake.run, request)),
      new RegExp(`GitHub Packages publish failed for ${escapeRegExp(candidates[1].spec)}`, 'u'),
    )
    assert.deepEqual(
      fake.publishCalls.map(({ spec }) => spec),
      [candidates[0].spec, candidates[1].spec],
    )
    assert.equal(fake.existing.has(candidates[0].spec), true)
    assert.equal(fake.existing.has(candidates[2].spec), false)
    assert.equal(fake.npmPublicWrites, 0)

    fake.publishFailure = undefined
    fake.publishCalls.length = 0
    await mirrorPackages(input(root, dirs, fake.run, request))
    assert.deepEqual(
      fake.publishCalls.map(({ spec }) => spec),
      [candidates[1].spec, candidates[2].spec],
    )
    assert.equal(fake.existing.size, 3)
    assert.equal(fake.npmPublicWrites, 0)
  })
})

test('rejects every API-exposed package link that is not the exact repository', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadata.get(candidate.slug).repository = { full_name: 'astrale-os/not-sdk' }
    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      /must be linked to astrale-os\/sdk/u,
    )
    assert.equal(fake.calls.length, 0)
  })

  await fixture(async ({ root, candidate, fake, request }) => {
    fake.metadata.get(candidate.slug).repository = null
    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      /must be linked to astrale-os\/sdk/u,
    )
    assert.equal(fake.calls.length, 0)
  })
})

test('admits repository metadata omitted from a repository-scoped workflow token', async () => {
  await fixture(async ({ root, candidate, fake, request }) => {
    delete fake.metadata.get(candidate.slug).repository

    await mirrorPackages(input(root, [candidate.directory], fake.run, request))

    assert.equal(fake.publishCalls.length, 1)
    assert.equal(fake.metadata.get(candidate.slug).visibility, 'private')
    assert.equal(fake.npmPublicWrites, 0)
  })
})

test('rejects an explicit link mismatch after an omitted preflight without reconciling tags', async () => {
  await fixture(async ({ root, candidate, fake }) => {
    const omitted = { ...fake.metadata.get(candidate.slug) }
    delete omitted.repository
    let requests = 0
    const request = async () =>
      response(
        200,
        requests++ === 0
          ? omitted
          : { ...omitted, repository: { full_name: 'astrale-os/not-sdk' } },
      )

    await assert.rejects(
      mirrorPackages(input(root, [candidate.directory], fake.run, request)),
      /must be linked to astrale-os\/sdk/u,
    )

    assert.equal(fake.publishCalls.length, 1)
    assert.deepEqual(fake.tagAdds, [])
    assert.equal(fake.npmPublicWrites, 0)
  })
})

function input(root, dirs, run, request) {
  return {
    cwd: root,
    dirs,
    githubToken: TOKEN,
    repository: REPOSITORY,
    githubApiUrl: 'https://api.github.test',
    runnerTemp: root,
    run,
    request,
    attempts: 1,
    delayMs: 0,
    wait: async () => {},
    environment: {},
  }
}

async function fixture(options, callback) {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }
  const root = await mkdtemp(join(tmpdir(), 'astrale-mirror-fixture-'))
  try {
    const candidates = []
    for (let index = 0; index < (options.count ?? 1); index += 1) {
      const slug = index === 0 ? 'sdk' : `adapter-${index}`
      const directory = index === 0 ? 'sdk' : slug
      const name = `@astrale-os/${slug}`
      const version = `1.0.0-beta.${index + 2}`
      const bytes = Buffer.from(`authoritative:${name}@${version}`)
      const candidate = {
        directory,
        slug,
        name,
        version,
        spec: `${name}@${version}`,
        bytes,
        integrity: digest(bytes),
      }
      candidates.push(candidate)
      await mkdir(join(root, directory), { recursive: true })
      await writeFile(
        join(root, directory, 'package.json'),
        `${JSON.stringify({
          name,
          version,
          repository: { type: 'git', url: 'git+https://github.com/astrale-os/sdk.git' },
          publishConfig: { access: 'public' },
        })}\n`,
      )
    }
    const fake = fakeBoundary(candidates)
    await callback({ root, candidate: candidates[0], candidates, fake, request: fake.request })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function fakeBoundary(candidates) {
  const calls = []
  const publishCalls = []
  const tagAdds = []
  const existing = new Set()
  const targetBytes = new Map()
  const sourceIntegrity = new Map(candidates.map(({ name, integrity }) => [name, integrity]))
  const metadata = new Map(
    candidates.map(({ slug, name }) => [
      slug,
      { name, visibility: 'private', repository: { full_name: REPOSITORY } },
    ]),
  )
  const metadataMissing = new Set()
  const tags = {
    npm: new Map(candidates.map(({ name, version }) => [name, new Map([['beta', version]])])),
    github: new Map(candidates.map(({ name }) => [name, new Map()])),
  }
  const apiCalls = []
  const commandEnvironments = []
  const configUses = []
  const boundary = {
    calls,
    publishCalls,
    tagAdds,
    existing,
    targetBytes,
    sourceIntegrity,
    metadata,
    metadataMissing,
    tags,
    apiCalls,
    commandEnvironments,
    configUses,
    npmPublicWrites: 0,
    targetReads: 0,
    deleteCalls: 0,
    lookupFailure: undefined,
    publishFailure: undefined,
    publishConflict: new Map(),
    githubTagLookup404s: 0,
    githubPack404s: 0,
    publishOutput: '+ published\n',
    metadataAlwaysMissing: new Set(),
    metadataMissingResponses: new Map(),
  }
  boundary.request = async (url, options) => {
    const slug = decodeURIComponent(url.split('/').at(-1))
    apiCalls.push({ url, authorization: options.headers.authorization })
    const missingResponses = boundary.metadataMissingResponses.get(slug) ?? 0
    if (missingResponses > 0) {
      boundary.metadataMissingResponses.set(slug, missingResponses - 1)
      return response(404, {})
    }
    if (boundary.metadataAlwaysMissing.has(slug)) return response(404, {})
    if (
      metadataMissing.has(slug) &&
      ![...existing].some((spec) => spec.startsWith(`@astrale-os/${slug}@`))
    ) {
      return response(404, {})
    }
    return response(200, metadata.get(slug))
  }
  boundary.run = (_command, args, options) => {
    calls.push(args)
    const registryIndex = args.indexOf('--registry')
    const github = registryIndex >= 0 && args[registryIndex + 1] === 'https://npm.pkg.github.com'
    const configPath = options.env.NPM_CONFIG_USERCONFIG
    const config = {
      github,
      path: configPath,
      contents: readFileSync(configPath, 'utf8'),
      mode: statSync(configPath).mode & 0o777,
      cwd: options.cwd,
    }
    configUses.push(config)
    commandEnvironments.push(options.env)
    const registry = github ? 'github' : 'npm'
    const operation = args[0]
    if (operation === 'view') {
      const spec = args[1]
      const candidate = candidates.find((value) => value.spec === spec)
      if (!candidate) return result(1, '', 'npm error E404')
      if (github) {
        if (boundary.lookupFailure) return result(1, '', boundary.lookupFailure)
        return existing.has(spec)
          ? result(0, `${JSON.stringify(candidate.version)}\n`)
          : result(1, '', 'npm error E404')
      }
      return result(
        0,
        `${JSON.stringify({
          name: candidate.name,
          version: candidate.version,
          'dist.integrity': sourceIntegrity.get(candidate.name),
        })}\n`,
      )
    }
    if (operation === 'pack') {
      const spec = args[1]
      const candidate = candidates.find((value) => value.spec === spec)
      const destination = args[args.indexOf('--pack-destination') + 1]
      if (github && boundary.githubPack404s > 0) {
        boundary.githubPack404s -= 1
        return result(1, '', 'npm error E404')
      }
      const bytes = github ? targetBytes.get(spec) : candidate.bytes
      if (!bytes) return result(1, '', 'npm error E404')
      if (github) boundary.targetReads += 1
      const filename = `${candidate.slug}-${candidate.version}.tgz`
      writeFileSync(join(destination, filename), bytes)
      return result(
        0,
        `${JSON.stringify([
          {
            name: candidate.name,
            version: candidate.version,
            filename,
            integrity: digest(bytes),
          },
        ])}\n`,
      )
    }
    if (operation === 'publish') {
      const tarball = args[1]
      const candidate = candidates.find(({ slug }) => basename(tarball).startsWith(`${slug}-`))
      publishCalls.push({
        spec: candidate.spec,
        tarball,
        bytes: readFileSync(tarball),
        args,
        config,
        environment: options.env,
      })
      if (!github) boundary.npmPublicWrites += 1
      if (boundary.publishConflict.has(candidate.spec)) {
        const bytes = boundary.publishConflict.get(candidate.spec)
        existing.add(candidate.spec)
        targetBytes.set(candidate.spec, bytes)
        const initialTag = args[args.indexOf('--tag') + 1]
        tags.github.get(candidate.name).set(initialTag, candidate.version)
        return result(1, '', 'npm error EPUBLISHCONFLICT 409 Conflict')
      }
      if (boundary.publishFailure === candidate.spec) return result(1, '', 'npm error E403')
      existing.add(candidate.spec)
      targetBytes.set(candidate.spec, candidate.bytes)
      const initialTag = args[args.indexOf('--tag') + 1]
      tags.github.get(candidate.name).set(initialTag, candidate.version)
      return result(0, boundary.publishOutput)
    }
    if (operation === 'dist-tag' && args[1] === 'ls') {
      const name = args[2]
      if (github && boundary.githubTagLookup404s > 0) {
        boundary.githubTagLookup404s -= 1
        return result(1, '', 'npm error E404')
      }
      const output = [...tags[registry].get(name)]
        .map(([tag, version]) => `${tag}: ${version}`)
        .join('\n')
      return result(0, `${output}\n`)
    }
    if (operation === 'dist-tag' && args[1] === 'add') {
      const spec = args[2]
      const tag = args[3]
      const candidate = candidates.find((value) => value.spec === spec)
      tagAdds.push({ spec, tag })
      tags.github.get(candidate.name).set(tag, candidate.version)
      return result(0, '')
    }
    if (operation === 'delete') boundary.deleteCalls += 1
    return result(1, '', `unexpected npm command: ${args.join(' ')}`)
  }
  return boundary
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body
    },
  }
}

function result(status, stdout = '', stderr = '') {
  return { status, stdout, stderr, output: `${stdout}${stderr}` }
}

function digest(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
