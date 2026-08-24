import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const publisher = fileURLToPath(new URL('./publish.sh', import.meta.url))
const publisherSource = await readFile(publisher, 'utf8')
const actionSource = await readFile(new URL('./action.yml', import.meta.url), 'utf8')

test('allows five minutes for immutable version and dist-tag propagation by default', () => {
  assert.match(publisherSource, /VERSION_VERIFY_ATTEMPTS:-60/)
  assert.match(publisherSource, /VERSION_VERIFY_DELAY_SECONDS:-5/)
  assert.match(publisherSource, /DIST_TAG_VERIFY_ATTEMPTS:-60/)
  assert.match(publisherSource, /DIST_TAG_VERIFY_DELAY_SECONDS:-5/)
})

test('offers no npm token input or registry-token fallback', () => {
  assert.doesNotMatch(actionSource, /npm-token|NPM_TOKEN/u)
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

async function runPublisher({ manifests, dirs, extraEnv = {} }) {
  const root = await mkdtemp(join(tmpdir(), 'astrale-publisher-test-'))
  const fakeBin = join(root, 'bin')
  const runnerTemp = join(root, 'runner')
  const publishLog = join(root, 'publish.log')

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
    ])
    await Promise.all([chmod(join(fakeBin, 'npm'), 0o755), chmod(join(fakeBin, 'pnpm'), 0o755)])

    const fakeTags = dirs
      .map((dir) => {
        const { name, version } = manifests[dir]
        const prerelease = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest'
        return `${name}|${prerelease}=${version}`
      })
      .join(',')

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
        FAKE_PUBLISHED_DIR: join(root, 'published'),
        FAKE_TAG_COUNTER: join(root, 'tag-counter'),
        FAKE_TAGS: fakeTags,
        VERSION_VERIFY_ATTEMPTS: '1',
        VERSION_VERIFY_DELAY_SECONDS: '0',
        DIST_TAG_VERIFY_ATTEMPTS: '1',
        DIST_TAG_VERIFY_DELAY_SECONDS: '0',
        ...extraEnv,
      },
    })

    let calls = []
    try {
      calls = (await readFile(publishLog, 'utf8')).trim().split('\n').filter(Boolean)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }

    return { ...result, calls, output: `${result.stdout}${result.stderr}` }
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
    manifests: { producer: npmPackages.producer },
    dirs: ['producer'],
    extraEnv: {
      VERSION_VERIFY_ATTEMPTS: '3',
      VERSION_VERIFY_DELAY_SECONDS: '0',
      FAKE_VERSION_DELAY_CALLS: '2',
    },
  })

  assert.equal(result.status, 0, result.output)
  assert.equal(result.calls.length, 1)
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
