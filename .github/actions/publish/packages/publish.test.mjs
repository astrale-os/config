import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const publisher = fileURLToPath(new URL('./publish.sh', import.meta.url))
const publisherSource = await readFile(publisher, 'utf8')
const actionSource = await readFile(new URL('./action.yml', import.meta.url), 'utf8')

test('allows fifteen minutes for version and dist-tag propagation by default', () => {
  assert.match(publisherSource, /REGISTRY_VISIBILITY_TIMEOUT_MINUTES:-15\}/u)
  assert.match(publisherSource, /local delay="\$\{delay_override:-10\}"/u)
  assert.match(
    actionSource,
    /registry-visibility-timeout-minutes:\n(?: {4}.+\n)*? {4}default: '15'/u,
  )
  assert.match(
    actionSource,
    /REGISTRY_VISIBILITY_TIMEOUT_MINUTES: \$\{\{ inputs\.registry-visibility-timeout-minutes \}\}/u,
  )
})

test('offers no npm token input or registry-token fallback', () => {
  assert.doesNotMatch(actionSource, /^  npm-token:/mu)
  assert.doesNotMatch(actionSource, /^\s+(?:NODE_AUTH_TOKEN|NPM_TOKEN):\s+\$\{\{/mu)
  assert.doesNotMatch(publisherSource, /registry\.npmjs\.org\/:_authToken/u)
  assert.match(publisherSource, /npm token authentication is forbidden/u)
})

const npmStub = [
  '#!/usr/bin/env bash',
  'set -u',
  'case "${1:-}" in',
  '  view)',
  '    spec="${2:-}"',
  '    field="${3:-}"',
  '    if [ -n "${FAKE_VIEW_FAIL_CONTAINS:-}" ] && [[ "$spec" == *"$FAKE_VIEW_FAIL_CONTAINS"* ]]; then',
  '      echo "npm error code E500" >&2',
  '      exit 1',
  '    fi',
  '    if [[ "$field" == dist-tags.* ]]; then',
  '      echo "publisher must use npm dist-tag ls, not npm view dist-tags" >&2',
  '      exit 8',
  '    fi',
  '    case ",${FAKE_EXISTING:-}," in',
  '      *",$spec,"*) printf "%s\\n" "${spec##*@}"; exit 0 ;;',
  '    esac',
  '    name="${spec%@*}"',
  '    slug="${name##*/}"',
  '    registry=npm',
  '    [[ "$*" != *npm.pkg.github.com* ]] || registry=gh',
  '    marker="$FAKE_PUBLISHED_DIR/$slug.$registry"',
  '    if [ -f "$marker" ]; then',
  '      count=0',
  '      counter="$marker.views"',
  '      [ ! -f "$counter" ] || read -r count < "$counter"',
  '      count=$((count + 1))',
  '      printf "%s\\n" "$count" > "$counter"',
  '      if [ "$count" -gt "${FAKE_VERSION_DELAY_CALLS:-0}" ]; then',
  '        printf "%s\\n" "${spec##*@}"',
  '        exit 0',
  '      fi',
  '    fi',
  '    echo "npm error code E404" >&2',
  '    exit 1',
  '    ;;',
  '  dist-tag)',
  '    [ "${2:-}" = ls ] || { echo "unexpected npm dist-tag command: $*" >&2; exit 9; }',
  '    name="${3:-}"',
  '    if [ -n "${FAKE_TAG_COUNTER:-}" ]; then',
  '      count=0',
  '      [ ! -f "$FAKE_TAG_COUNTER" ] || read -r count < "$FAKE_TAG_COUNTER"',
  '      count=$((count + 1))',
  '      printf "%s\\n" "$count" > "$FAKE_TAG_COUNTER"',
  '      [ "$count" -gt "${FAKE_TAG_DELAY_CALLS:-0}" ] || exit 0',
  '    fi',
  '    IFS=, read -r -a tags <<< "${FAKE_TAGS:-}"',
  '    for entry in "${tags[@]}"; do',
  '      if [[ "$entry" == "$name|"*"="* ]]; then',
  '        key="${entry%%=*}"',
  '        printf "%s: %s\\n" "${key#*|}" "${entry#*=}"',
  '      fi',
  '    done',
  '    exit 0',
  '    ;;',
  '  publish)',
  '    printf "%s\\n" "$*" >> "$FAKE_PUBLISH_LOG"',
  '    if [ -n "${FAKE_FAIL_CONTAINS:-}" ] && [[ "$*" == *"$FAKE_FAIL_CONTAINS"* ]]; then',
  '      echo "${FAKE_FAIL_OUTPUT:-npm error code E500}" >&2',
  '      exit 1',
  '    fi',
  '    tarball="${2:-}"',
  '    slug="$(basename "$tarball" .tgz)"',
  '    slug="${slug%-prepared}"',
  '    registry=npm',
  '    [[ "$*" != *npm.pkg.github.com* ]] || registry=gh',
  '    : > "$FAKE_PUBLISHED_DIR/$slug.$registry"',
  '    echo "+ fake publish"',
  '    exit 0',
  '    ;;',
  '  *) echo "unexpected npm command: $*" >&2; exit 9 ;;',
  'esac',
  '',
].join('\n')

const pnpmStub = [
  '#!/usr/bin/env bash',
  'set -eu',
  'if [ "${1:-}" = view ]; then',
  '  printf "pnpm %s\\n" "$*" >> "$FAKE_LOOKUP_LOG"',
  '  spec="${2:-}"',
  '  case ",${FAKE_EXISTING:-}," in',
  '    *",$spec,"*) printf "%s\\n" "${spec##*@}"; exit 0 ;;',
  '  esac',
  '  name="${spec%@*}"',
  '  slug="${name##*/}"',
  '  marker="$FAKE_PUBLISHED_DIR/$slug.npm"',
  '  if [ -f "$marker" ]; then',
  '    count=0',
  '    counter="$marker.pnpm-views"',
  '    [ ! -f "$counter" ] || read -r count < "$counter"',
  '    count=$((count + 1))',
  '    printf "%s\\n" "$count" > "$counter"',
  '    if [ "$count" -gt "${FAKE_VERSION_DELAY_CALLS:-0}" ]; then',
  '      printf "%s\\n" "${spec##*@}"',
  '      exit 0',
  '    fi',
  '  fi',
  '  echo "pnpm error ERR_PNPM_NO_MATCHING_VERSION" >&2',
  '  exit 1',
  'fi',
  'package_dir=""',
  'destination=""',
  'while [ "$#" -gt 0 ]; do',
  '  case "$1" in',
  '    --dir) package_dir="$2"; shift 2 ;;',
  '    --pack-destination) destination="$2"; shift 2 ;;',
  '    *) shift ;;',
  '  esac',
  'done',
  'mkdir -p "$destination"',
  ': > "$destination/$(basename "$package_dir").tgz"',
  '',
].join('\n')

const sleepStub = ['#!/usr/bin/env bash', 'printf "%s\\n" "$1" >> "$FAKE_SLEEP_LOG"', ''].join('\n')

async function readLines(path) {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return []
  }
}

async function runPublisher({ manifests, dirs, extraEnv = {}, prebuilt = false }) {
  const root = await mkdtemp(join(tmpdir(), 'astrale-publisher-test-'))
  const fakeBin = join(root, 'bin')
  const runnerTemp = join(root, 'runner')
  const publishLog = join(root, 'publish.log')
  const lookupLog = join(root, 'lookup.log')
  const sleepLog = join(root, 'sleep.log')

  try {
    await Promise.all([mkdir(fakeBin), mkdir(runnerTemp), mkdir(join(root, 'published'))])
    await Promise.all(
      Object.entries(manifests).map(async ([dir, manifest]) => {
        await mkdir(join(root, dir), { recursive: true })
        await writeFile(join(root, dir, 'package.json'), `${JSON.stringify(manifest)}\n`)
      }),
    )
    await Promise.all([
      writeFile(join(fakeBin, 'npm'), npmStub),
      writeFile(join(fakeBin, 'pnpm'), pnpmStub),
      writeFile(join(fakeBin, 'sleep'), sleepStub),
    ])
    await Promise.all(['npm', 'pnpm', 'sleep'].map((bin) => chmod(join(fakeBin, bin), 0o755)))

    const fakeTags = dirs
      .map((dir) => {
        const { name, version } = manifests[dir]
        const prerelease = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest'
        return `${name}|${prerelease}=${version}`
      })
      .join(',')

    const tarballs = {}
    if (prebuilt) {
      for (const dir of dirs) {
        const packageRoot = join(runnerTemp, `${dir}-archive`, 'package')
        await mkdir(packageRoot, { recursive: true })
        await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifests[dir]))
        const path = join(runnerTemp, `${dir}-prepared.tgz`)
        execFileSync('tar', ['-czf', path, 'package'], { cwd: join(runnerTemp, `${dir}-archive`) })
        tarballs[dir] = path
      }
      if (prebuilt === 'swapped' && dirs.length === 2) {
        const first = tarballs[dirs[0]]
        tarballs[dirs[0]] = tarballs[dirs[1]]
        tarballs[dirs[1]] = first
      }
    }

    const result = spawnSync('bash', [publisher], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PUBLISH_DIRS: dirs.join(' '),
        RUNNER_TEMP: runnerTemp,
        GH_PACKAGES_TOKEN: '',
        MIRROR_PUBLIC_PACKAGES: 'true',
        NPM_TOKEN: '',
        FAKE_PUBLISH_LOG: publishLog,
        FAKE_LOOKUP_LOG: lookupLog,
        FAKE_SLEEP_LOG: sleepLog,
        FAKE_PUBLISHED_DIR: join(root, 'published'),
        FAKE_TAG_COUNTER: join(root, 'tag-counter'),
        FAKE_TAGS: fakeTags,
        VERSION_VERIFY_ATTEMPTS: '1',
        VERSION_VERIFY_DELAY_SECONDS: '0',
        DIST_TAG_VERIFY_ATTEMPTS: '1',
        DIST_TAG_VERIFY_DELAY_SECONDS: '0',
        PUBLISH_TARBALLS_JSON: JSON.stringify(tarballs),
        ...extraEnv,
      },
    })

    const [calls, lookups, sleeps] = await Promise.all(
      [publishLog, lookupLog, sleepLog].map(readLines),
    )

    return { ...result, calls, lookups, sleeps, output: `${result.stdout}${result.stderr}` }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const npmPackages = {
  producer: { name: 'producer', version: '1.0.0' },
  consumer: { name: 'consumer', version: '1.0.0', dependencies: { producer: '^1.0.0' } },
}

test('stops before a consumer when its npm producer fails', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer', 'consumer'],
    extraEnv: {
      FAKE_FAIL_CONTAINS: 'producer.tgz --access public',
      FAKE_FAIL_OUTPUT: 'npm error code E401 Unable to authenticate',
    },
  })

  assert.equal(result.status, 1)
  assert.equal(result.calls.length, 1)
  assert.match(result.calls[0], /producer\.tgz/)
  assert.doesNotMatch(result.output, /publish package: consumer/)
})

test('publishes producers and consumers sequentially on success', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer', 'consumer'],
  })

  assert.equal(result.status, 0, result.output)
  assert.equal(result.calls.length, 2)
  assert.match(result.calls[0], /producer\.tgz/)
  assert.match(result.calls[1], /consumer\.tgz/)
})

test('publishes the exact prebuilt tarballs supplied by an owning qualifier', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer', 'consumer'],
    prebuilt: true,
  })

  assert.equal(result.status, 0, result.output)
  assert.match(result.calls[0], /producer-prepared\.tgz/u)
  assert.match(result.calls[1], /consumer-prepared\.tgz/u)
})

test('rejects a swapped prebuilt tarball before registry mutation', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer', 'consumer'],
    prebuilt: 'swapped',
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.match(result.output, /Prepared tarball identity for producer is consumer@1\.0\.0/u)
})

test('rejects an ambient npm token instead of using it as a fallback', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer'],
    extraEnv: { NPM_TOKEN: 'forbidden-token' },
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.match(result.output, /npm token authentication is forbidden/u)
})

test('waits for a published dist-tag to propagate before continuing', async () => {
  const result = await runPublisher({
    manifests: { producer: npmPackages.producer },
    dirs: ['producer'],
    extraEnv: {
      DIST_TAG_VERIFY_ATTEMPTS: '3',
      DIST_TAG_VERIFY_DELAY_SECONDS: '0',
      FAKE_TAG_DELAY_CALLS: '2',
    },
  })

  assert.equal(result.status, 0, result.output)
  assert.equal(result.calls.length, 1)
})

test('waits for an acknowledged immutable version to become registry-visible', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer', 'consumer'],
    extraEnv: {
      VERSION_VERIFY_ATTEMPTS: '6',
      VERSION_VERIFY_DELAY_SECONDS: '0',
      FAKE_VERSION_DELAY_CALLS: '4',
    },
  })

  assert.equal(result.status, 0, result.output)
  assert.equal(result.calls.length, 2)
  assert.match(
    result.output,
    /waiting for producer@1\.0\.0 on https:\/\/registry\.npmjs\.org \(attempt 4\/6/u,
  )
  assert.match(
    result.output,
    /producer@1\.0\.0 is visible on https:\/\/registry\.npmjs\.org after 5 attempts/u,
  )
  assert.ok(
    result.output.indexOf('after 5 attempts') < result.output.indexOf('publish package: consumer'),
    'the consumer must start only after its producer is visible',
  )
})

test('checks visibility with an exact-version pnpm lookup on the publish registry', async () => {
  const result = await runPublisher({
    manifests: { producer: npmPackages.producer },
    dirs: ['producer'],
  })

  assert.equal(result.status, 0, result.output)
  assert.deepEqual(result.lookups, [
    'pnpm view producer@1.0.0 version --registry=https://registry.npmjs.org',
  ])
})

test('fails closed before a consumer when a version never becomes visible', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer', 'consumer'],
    extraEnv: {
      VERSION_VERIFY_ATTEMPTS: '3',
      VERSION_VERIFY_DELAY_SECONDS: '0',
      FAKE_VERSION_DELAY_CALLS: '1000',
    },
  })

  assert.equal(result.status, 1)
  assert.equal(result.calls.length, 1)
  assert.equal(result.lookups.length, 3)
  assert.match(
    result.output,
    /pnpm visibility check for producer@1\.0\.0 on https:\/\/registry\.npmjs\.org returned/u,
  )
  assert.match(
    result.output,
    /npm immutable version producer@1\.0\.0 is not registry-visible after 15 minutes\. Re-run the failed job to resume/u,
  )
  assert.doesNotMatch(result.output, /publish package: consumer/)
})

test('derives the poll count from the configured visibility bound', async () => {
  const result = await runPublisher({
    manifests: { producer: npmPackages.producer },
    dirs: ['producer'],
    extraEnv: {
      REGISTRY_VISIBILITY_TIMEOUT_MINUTES: '2',
      VERSION_VERIFY_ATTEMPTS: '',
      VERSION_VERIFY_DELAY_SECONDS: '',
      FAKE_VERSION_DELAY_CALLS: '1000',
    },
  })

  // 2 minutes at the default 10-second interval: an immediate attempt plus 12 more.
  assert.equal(result.status, 1)
  assert.equal(result.lookups.length, 13)
  assert.deepEqual(result.sleeps, Array(12).fill('10'))
  assert.match(result.output, /not registry-visible after 2 minutes/u)
})

test('rejects an invalid visibility bound before publishing anything', async () => {
  for (const value of ['0', '61', 'soon', '']) {
    const result = await runPublisher({
      manifests: { producer: npmPackages.producer },
      dirs: ['producer'],
      extraEnv: { REGISTRY_VISIBILITY_TIMEOUT_MINUTES: value },
    })

    if (value === '') {
      // An empty value (unset input) falls back to the default bound.
      assert.equal(result.status, 0, result.output)
      continue
    }
    assert.equal(result.status, 1, value)
    assert.deepEqual(result.calls, [])
    assert.match(result.output, /registry-visibility-timeout-minutes must be a whole number/u)
  }
})

test('stops on an inconclusive producer lookup', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer', 'consumer'],
    extraEnv: { FAKE_VIEW_FAIL_CONTAINS: 'producer@1.0.0' },
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.doesNotMatch(result.output, /publish package: consumer/)
})

test('an existing producer is an idempotent skip and allows its consumer', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['producer', 'consumer'],
    extraEnv: { FAKE_EXISTING: 'producer@1.0.0' },
  })

  assert.equal(result.status, 0, result.output)
  assert.equal(result.calls.length, 1)
  assert.match(result.calls[0], /consumer\.tgz/)
})

test('rejects an existing version whose release-channel tag points elsewhere', async () => {
  const result = await runPublisher({
    manifests: {
      producer: { name: 'producer', version: '1.0.0-beta.2' },
      consumer: {
        name: 'consumer',
        version: '1.0.0-beta.2',
        dependencies: { producer: '^1.0.0-beta.2' },
      },
    },
    dirs: ['producer', 'consumer'],
    extraEnv: {
      FAKE_EXISTING: 'producer@1.0.0-beta.2',
      FAKE_TAGS: 'producer|beta=1.0.0-beta.1,consumer|beta=1.0.0-beta.2',
    },
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.match(result.output, /npm dist-tag producer@beta does not resolve to 1\.0\.0-beta\.2/)
  assert.doesNotMatch(result.output, /publish package: consumer/)
})

test('stops before a consumer when its GitHub Packages producer fails', async () => {
  const result = await runPublisher({
    manifests: {
      producer: {
        name: '@astrale-os/producer',
        version: '1.0.0',
        publishConfig: { registry: 'https://npm.pkg.github.com' },
      },
      consumer: { name: 'consumer', version: '1.0.0' },
    },
    dirs: ['producer', 'consumer'],
    extraEnv: {
      GH_PACKAGES_TOKEN: 'fake-token',
      FAKE_FAIL_CONTAINS: 'producer.tgz --access=restricted',
      FAKE_FAIL_OUTPUT: 'npm error code E403 permission denied',
    },
  })

  assert.equal(result.status, 1)
  assert.equal(result.calls.length, 1)
  assert.match(result.calls[0], /producer\.tgz/)
  assert.doesNotMatch(result.output, /publish package: consumer/)
})

test('rejects an existing GitHub Packages version with the wrong dist-tag', async () => {
  const result = await runPublisher({
    manifests: {
      producer: {
        name: '@astrale-os/producer',
        version: '1.0.0-beta.2',
        publishConfig: { registry: 'https://npm.pkg.github.com' },
      },
      consumer: { name: 'consumer', version: '1.0.0-beta.2' },
    },
    dirs: ['producer', 'consumer'],
    extraEnv: {
      GH_PACKAGES_TOKEN: 'fake-token',
      FAKE_EXISTING: '@astrale-os/producer@1.0.0-beta.2',
      FAKE_TAGS: '@astrale-os/producer|beta=1.0.0-beta.1,consumer|beta=1.0.0-beta.2',
    },
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.match(
    result.output,
    /GitHub Packages dist-tag @astrale-os\/producer@beta does not resolve to 1\.0\.0-beta\.2/,
  )
  assert.doesNotMatch(result.output, /publish package: consumer/)
})

test('accepts a GitHub Packages prerelease tag when no latest tag exists', async () => {
  const result = await runPublisher({
    manifests: {
      producer: {
        name: '@astrale-os/producer',
        version: '1.0.0-beta.2',
        publishConfig: { registry: 'https://npm.pkg.github.com' },
      },
    },
    dirs: ['producer'],
    extraEnv: {
      GH_PACKAGES_TOKEN: 'fake-token',
      FAKE_EXISTING: '@astrale-os/producer@1.0.0-beta.2',
      FAKE_TAGS: '@astrale-os/producer|beta=1.0.0-beta.2',
    },
  })

  assert.equal(result.status, 0, result.output)
  assert.deepEqual(result.calls, [])
})

test('finishes every producer registry before starting a public consumer', async () => {
  const result = await runPublisher({
    manifests: {
      producer: { name: '@astrale-os/producer', version: '1.0.0' },
      consumer: {
        name: '@astrale-os/consumer',
        version: '1.0.0',
        dependencies: { '@astrale-os/producer': '^1.0.0' },
      },
    },
    dirs: ['producer', 'consumer'],
    extraEnv: {
      GH_PACKAGES_TOKEN: 'fake-token',
      FAKE_FAIL_CONTAINS: 'producer.tgz --access=restricted',
      FAKE_FAIL_OUTPUT: 'npm error code E403 permission denied',
    },
  })

  assert.equal(result.status, 1)
  assert.equal(result.calls.length, 2)
  assert.match(result.calls[0], /producer\.tgz --access public/)
  assert.match(result.calls[1], /producer\.tgz --access=restricted/)
  assert.doesNotMatch(result.output, /publish package: consumer/)
})

test('fails missing required registry credentials before publishing anything', async () => {
  const result = await runPublisher({
    manifests: {
      producer: { name: '@astrale-os/producer', version: '1.0.0' },
      consumer: { name: 'consumer', version: '1.0.0' },
    },
    dirs: ['producer', 'consumer'],
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.match(result.output, /GitHub Packages token is required/)
})

test('publishes public scoped packages to npm without requiring the optional mirror', async () => {
  const result = await runPublisher({
    manifests: {
      producer: { name: '@astrale-os/producer', version: '1.0.0' },
      consumer: {
        name: '@astrale-os/consumer',
        version: '1.0.0',
        dependencies: { '@astrale-os/producer': '^1.0.0' },
      },
    },
    dirs: ['producer', 'consumer'],
    extraEnv: { MIRROR_PUBLIC_PACKAGES: 'false' },
  })

  assert.equal(result.status, 0, result.output)
  assert.equal(result.calls.length, 2)
  assert.match(result.calls[0], /producer\.tgz --access public/)
  assert.match(result.calls[1], /consumer\.tgz --access public/)
  assert.doesNotMatch(result.output, /GitHub Packages token is required/)
})

test('rejects an invalid public mirror mode before publishing anything', async () => {
  const result = await runPublisher({
    manifests: { producer: npmPackages.producer },
    dirs: ['producer'],
    extraEnv: { MIRROR_PUBLIC_PACKAGES: 'sometimes' },
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.match(result.output, /MIRROR_PUBLIC_PACKAGES must be true or false/)
})

test('rejects a non-topological input before contacting a registry', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['consumer', 'producer'],
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.match(result.output, /Publish order is not producer-first/)
})
