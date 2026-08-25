import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const installer = path.resolve('.github/actions/install-dependencies.sh')

async function runInstaller({ frozen = 'true', token = '' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'config-install-boundary-'))
  const bin = path.join(directory, 'bin')
  const log = path.join(directory, 'pnpm.log')
  const fakePnpm = path.join(bin, 'pnpm')
  await mkdir(bin)
  await writeFile(
    fakePnpm,
    `#!/usr/bin/env bash
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
`,
  )
  await chmod(fakePnpm, 0o755)

  try {
    const result = await new Promise((resolve) => {
      const child = spawn('bash', [installer], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          INSTALL_LOG: log,
          INSTALL_FROZEN_LOCKFILE: frozen,
          NODE_AUTH_TOKEN: token,
          NPM_TOKEN: 'ambient-npm-token',
          GH_TOKEN: 'ambient-gh-token',
          GITHUB_TOKEN: 'ambient-github-token',
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'ambient-oidc-token',
          ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid',
          ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN: 'ambient-app-token',
          ASTRALE_AUTONOMOUS_INSTALL_TOKEN: 'ambient-autonomous-token',
          NPM_CONFIG_USERCONFIG: '/authenticated/userconfig',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('close', (code) => resolve({ code, stderr }))
    })

    assert.equal(result.code, 0, result.stderr)
    return (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('authenticated fetch disables scripts then rebuilds without credentials', async () => {
  const calls = await runInstaller({ token: 'ephemeral-test-token' })

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
  const calls = await runInstaller({ frozen: 'false' })

  assert.deepEqual(calls, [
    ['install', '', '', '', '', '', '', '', '', '/authenticated/userconfig'],
  ])
})
