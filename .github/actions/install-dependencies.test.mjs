import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const installer = path.resolve('.github/actions/install-dependencies.sh')
const rebuilder = path.resolve('.github/actions/rebuild-dependencies.sh')
const credentialVariables = [
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN',
  'ASTRALE_AUTONOMOUS_INSTALL_TOKEN',
]

function runScript(script, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn('bash', [script], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, pid: child.pid, stderr }))
  })
}

async function runBoundary({ frozen = 'true', inspectAncestors = false, token = '' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'config-install-boundary-'))
  const bin = path.join(directory, 'bin')
  const log = path.join(directory, 'pnpm.log')
  const ancestorLog = path.join(directory, 'ancestors.log')
  const fakePnpm = path.join(bin, 'pnpm')
  const lifecycleProbe = path.join(directory, 'lifecycle-probe.sh')
  await mkdir(bin)
  await writeFile(
    fakePnpm,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \\
  "$*" \\
  "\${NODE_AUTH_TOKEN-}" \\
  "\${NPM_TOKEN-}" \\
  "\${GH_TOKEN-}" \\
  "\${GITHUB_TOKEN-}" \\
  "\${ACTIONS_ID_TOKEN_REQUEST_TOKEN-}" \\
  "\${ACTIONS_ID_TOKEN_REQUEST_URL-}" \\
  "\${ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN-}" \\
  "\${ASTRALE_AUTONOMOUS_INSTALL_TOKEN-}" \\
  "\${NPM_CONFIG_USERCONFIG-}" >> "$INSTALL_LOG"

if [[ "$*" == '-r rebuild --pending' && -n "\${LIFECYCLE_PROBE-}" ]]; then
  bash "$LIFECYCLE_PROBE"
fi
`,
  )
  await writeFile(
    lifecycleProbe,
    `#!/usr/bin/env bash
set -euo pipefail

pid="$PPID"
checked=0
: > "$ANCESTOR_LOG"
while [[ "$pid" =~ ^[0-9]+$ ]] && (( pid > 0 )); do
  environment_file="/proc/$pid/environ"
  status_file="/proc/$pid/status"
  if environment="$(LC_ALL=C tr '\\0' '\\n' < "$environment_file" 2>/dev/null)"; then
    if [[ "$environment" == *'NODE_AUTH_TOKEN=ephemeral-test-token'* ]]; then
      printf 'credential found in ancestor %s\\n' "$pid" >&2
      exit 91
    fi
    printf '%s readable\\n' "$pid" >> "$ANCESTOR_LOG"
  else
    printf '%s unreadable\\n' "$pid" >> "$ANCESTOR_LOG"
  fi
  checked=$((checked + 1))

  if [[ ! -r "$status_file" ]]; then
    break
  fi
  parent_pid="$(awk '$1 == "PPid:" { print $2 }' "$status_file")"
  if [[ -z "$parent_pid" || "$parent_pid" == "$pid" ]]; then
    break
  fi
  pid="$parent_pid"
done

printf 'checked=%s\\n' "$checked" >> "$ANCESTOR_LOG"
(( checked > 0 ))
`,
  )
  await chmod(fakePnpm, 0o755)
  await chmod(lifecycleProbe, 0o755)

  const baseEnv = {
    ...process.env,
    ANCESTOR_LOG: ancestorLog,
    LIFECYCLE_PROBE: inspectAncestors ? lifecycleProbe : '',
    PATH: `${bin}:${process.env.PATH}`,
    INSTALL_LOG: log,
    NPM_CONFIG_USERCONFIG: '/authenticated/userconfig',
  }

  try {
    const installResult = await runScript(installer, {
      cwd: directory,
      env: {
        ...baseEnv,
        INSTALL_FROZEN_LOCKFILE: frozen,
        NODE_AUTH_TOKEN: token,
        NPM_TOKEN: 'ambient-npm-token',
        GH_TOKEN: 'ambient-gh-token',
        GITHUB_TOKEN: 'ambient-github-token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'ambient-oidc-token',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid',
        ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN: 'ambient-app-token',
        ASTRALE_AUTONOMOUS_INSTALL_TOKEN: 'ambient-autonomous-token',
      },
    })
    assert.equal(installResult.code, 0, installResult.stderr)

    if (token) {
      const rebuildEnv = { ...baseEnv }
      for (const variable of credentialVariables) rebuildEnv[variable] = ''

      const rebuildResult = await runScript(rebuilder, { cwd: directory, env: rebuildEnv })
      assert.equal(rebuildResult.code, 0, rebuildResult.stderr)
    }

    const calls = (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'))
    const inspectedAncestors = inspectAncestors ? await readFile(ancestorLog, 'utf8') : ''
    return { calls, inspectedAncestors }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('authenticated fetch exits before a credential-free rebuild process starts', async () => {
  const { calls } = await runBoundary({ token: 'ephemeral-test-token' })

  assert.deepEqual(
    calls.map(([command]) => command),
    ['install --frozen-lockfile --ignore-scripts', '-r rebuild --pending'],
  )
  assert.deepEqual(calls[0].slice(1), [
    'ephemeral-test-token',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '/authenticated/userconfig',
  ])
  assert.deepEqual(calls[1].slice(1, 9), ['', '', '', '', '', '', '', ''])
  assert.notEqual(calls[1][9], '/authenticated/userconfig')
})

test('unauthenticated install keeps normal lifecycle handling but scrubs ambient credentials', async () => {
  const { calls } = await runBoundary({ frozen: 'false' })

  assert.deepEqual(calls, [
    ['install', '', '', '', '', '', '', '', '', '/authenticated/userconfig'],
  ])
})

test(
  'Linux lifecycle cannot recover the install token from any live ancestor environment',
  { skip: process.platform !== 'linux' },
  async () => {
    const { calls, inspectedAncestors } = await runBoundary({
      inspectAncestors: true,
      token: 'ephemeral-test-token',
    })

    assert.equal(calls.at(-1)?.[0], '-r rebuild --pending')
    assert.match(inspectedAncestors, /checked=[1-9][0-9]*/)
    assert.doesNotMatch(inspectedAncestors, /credential found/)
  },
)
