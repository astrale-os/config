import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const publisher = fileURLToPath(new URL('./publish.sh', import.meta.url))

const npmStub = [
  '#!/usr/bin/env bash',
  'set -u',
  'case "${1:-}" in',
  '  view)',
  '    spec="${2:-}"',
  '    if [ -n "${FAKE_VIEW_FAIL_CONTAINS:-}" ] && [[ "$spec" == *"$FAKE_VIEW_FAIL_CONTAINS"* ]]; then',
  '      echo "npm error code E500" >&2',
  '      exit 1',
  '    fi',
  '    case ",${FAKE_EXISTING:-}," in',
  '      *",$spec,"*) printf "%s\\n" "${spec##*@}"; exit 0 ;;',
  '    esac',
  '    echo "npm error code E404" >&2',
  '    exit 1',
  '    ;;',
  '  publish)',
  '    printf "%s\\n" "$*" >> "$FAKE_PUBLISH_LOG"',
  '    if [ -n "${FAKE_FAIL_CONTAINS:-}" ] && [[ "$*" == *"$FAKE_FAIL_CONTAINS"* ]]; then',
  '      echo "${FAKE_FAIL_OUTPUT:-npm error code E500}" >&2',
  '      exit 1',
  '    fi',
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
    await Promise.all([mkdir(fakeBin), mkdir(runnerTemp)])
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

    const result = spawnSync('bash', [publisher], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PUBLISH_DIRS: dirs.join(' '),
        RUNNER_TEMP: runnerTemp,
        GH_PACKAGES_TOKEN: '',
        NPM_TOKEN: '',
        FAKE_PUBLISH_LOG: publishLog,
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

test('rejects a non-topological input before contacting a registry', async () => {
  const result = await runPublisher({
    manifests: npmPackages,
    dirs: ['consumer', 'producer'],
  })

  assert.equal(result.status, 1)
  assert.deepEqual(result.calls, [])
  assert.match(result.output, /Publish order is not producer-first/)
})
