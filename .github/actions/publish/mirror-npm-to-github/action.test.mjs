import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const action = await readFile(new URL('./action.yml', import.meta.url), 'utf8')
const steps = action
  .split('\n    - name: ')
  .slice(1)
  .map((step) => `    - name: ${step}`)

test('requires an explicit repository and GitHub token', () => {
  assert.match(action, /github-token:\n(?: {4}.+\n)*? {4}required: true/u)
  assert.match(action, /repository:\n(?: {4}.+\n)*? {4}required: true/u)
})

test('pins the mirror npm toolchain and never installs or builds a workspace', () => {
  assert.deepEqual(
    [...action.matchAll(/^      run: (.+)$/gmu)].map((match) => match[1]),
    ['npm install -g npm@11.19.0', 'node "${{ github.action_path }}/mirror.mjs"'],
  )
  assert.equal(steps.length, 3)
  assert.match(steps[1], /^    - name: Pin npm\n/u)
  assert.doesNotMatch(action, /pnpm|yarn|bun|npm (?:ci|install(?! -g npm@11\.19\.0))|\bbuild\b/iu)
})

test('passes credentials only to the mirror process', () => {
  assert.equal(action.match(/\$\{\{ inputs\.github-token \}\}/gu)?.length, 1)
  assert.equal(action.match(/MIRROR_GITHUB_TOKEN/gu)?.length, 1)
  assert.match(steps[2], /^    - name: Mirror exact npm artifacts\n/u)
  assert.match(steps[2], /MIRROR_GITHUB_TOKEN: \$\{\{ inputs\.github-token \}\}/u)
  assert.doesNotMatch(steps.slice(0, 2).join('\n'), /github-token|MIRROR_GITHUB_TOKEN/u)
  assert.doesNotMatch(action, /NODE_AUTH_TOKEN|NPM_TOKEN/u)
})

test('wires every mirror input to the one execution step', () => {
  assert.match(action, /dirs:\n(?: {4}.+\n)*? {4}required: true/u)
  assert.match(steps[0], /^    - name: Setup Node\.js\n/u)
  assert.match(steps[0], /node-version-file: \$\{\{ inputs\.node-version-file \}\}/u)
  assert.match(steps[2], /MIRROR_DIRS: \$\{\{ inputs\.dirs \}\}/u)
  assert.match(steps[2], /MIRROR_REPOSITORY: \$\{\{ inputs\.repository \}\}/u)
  assert.match(steps[2], /MIRROR_GITHUB_API_URL: \$\{\{ github\.api_url \}\}/u)
  assert.match(steps[2], /node "\$\{\{ github\.action_path \}\}\/mirror\.mjs"/u)
})
