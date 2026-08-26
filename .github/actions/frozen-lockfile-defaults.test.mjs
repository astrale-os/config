import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const actions = [
  '.github/actions/ci/action.yml',
  '.github/actions/setup/action.yml',
  '.github/actions/publish/jsr/action.yml',
  '.github/actions/publish/npm/action.yml',
]
const authenticatedActions = new Set([
  '.github/actions/ci/action.yml',
  '.github/actions/setup/action.yml',
])

test('shared install actions default to frozen lockfiles', async () => {
  const installer = await readFile('.github/actions/install-dependencies.sh', 'utf8')
  const rebuilder = await readFile('.github/actions/rebuild-dependencies.sh', 'utf8')
  const tokenFreeRunner = await readFile('.github/actions/run-token-free.sh', 'utf8')

  for (const file of actions) {
    const source = await readFile(file, 'utf8')
    const input = source.match(/  frozen-lockfile:\n(?:    .+\n)+?    default: '([^']+)'/)

    assert.equal(input?.[1], 'true', `${file} must default frozen-lockfile to true`)
    if (authenticatedActions.has(file)) {
      assert.match(
        source,
        /run: bash "\$\{\{ github\.action_path \}\}\/\.\.\/install-dependencies\.sh"/,
      )
      assert.match(
        source,
        /run: bash "\$\{\{ github\.action_path \}\}\/\.\.\/rebuild-dependencies\.sh"/,
      )
      assert.match(source, /INSTALL_FROZEN_LOCKFILE: \$\{\{ inputs\.frozen-lockfile \}\}/)
      assert.doesNotMatch(source, /Setup Node\.js \(with registry \+ cache\)/)
      assert.match(
        source,
        /if: inputs\.registry-url == '' && inputs\.token == '' && inputs\.frozen-lockfile == 'true' && inputs\.cache == 'true'/,
      )
      assert.match(source, /  cache:\n(?:    .+\n)+?    default: 'true'/)
      const installIndex = source.indexOf('../install-dependencies.sh')
      const rebuildIndex = source.indexOf('../rebuild-dependencies.sh')
      assert.ok(installIndex >= 0 && installIndex < rebuildIndex)

      const rebuildStep = source.slice(
        source.lastIndexOf('\n    - name:', rebuildIndex),
        rebuildIndex + 800,
      )
      assert.match(rebuildStep, /if: inputs\.token != ''/)
      assert.match(rebuildStep, /NODE_AUTH_TOKEN: ''/)
      assert.match(rebuildStep, /ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN: ''/)
      assert.doesNotMatch(rebuildStep, /NODE_AUTH_TOKEN: \$\{\{ inputs\.token \}\}/)
    } else {
      assert.match(source, /run: pnpm install --frozen-lockfile/)
    }
  }

  assert.match(installer, /install_args\+=\(--frozen-lockfile\)/)
  assert.match(installer, /--ignore-scripts/)
  assert.doesNotMatch(installer, /pnpm(?:\s+-r)?\s+rebuild|rebuild-dependencies\.sh/)
  assert.match(rebuilder, /run-token-free\.sh" pnpm -r rebuild --pending/)
  assert.doesNotMatch(rebuilder, /inputs\.token|NODE_AUTH_TOKEN=.*\$\{/)
  assert.match(tokenFreeRunner, /unset NODE_AUTH_TOKEN NPM_TOKEN GH_TOKEN GITHUB_TOKEN/)
  assert.match(tokenFreeRunner, /unset NPM_CONFIG_USERCONFIG npm_config_userconfig/)
  assert.match(tokenFreeRunner, /unset NPM_CONFIG_GLOBALCONFIG npm_config_globalconfig/)
  assert.match(tokenFreeRunner, /registry=https:\/\/registry\.npmjs\.org\//)
  assert.match(tokenFreeRunner, /@astrale-os:registry=https:\/\/registry\.npmjs\.org\//)
  assert.match(tokenFreeRunner, /@jsr:registry=https:\/\/npm\.jsr\.io\//)
  assert.match(tokenFreeRunner, /NPM_CONFIG_OFFLINE='true'/)
  assert.doesNotMatch(tokenFreeRunner, /npm\.pkg\.github\.com|:_authToken|inputs\.token/)

  const ciAction = await readFile('.github/actions/ci/action.yml', 'utf8')
  const postInstallSteps = [
    'Build packages (before checks)',
    'Run oxlint',
    'Check formatting',
    'Run type check',
    'Run tests',
    'Build packages (after checks)',
  ]
  for (const [index, name] of postInstallSteps.entries()) {
    const start = ciAction.indexOf(`    - name: ${name}`)
    const end =
      index + 1 < postInstallSteps.length
        ? ciAction.indexOf(`    - name: ${postInstallSteps[index + 1]}`, start)
        : ciAction.length
    assert.ok(start >= 0 && end > start, `${name} must remain present`)
    assert.match(ciAction.slice(start, end), /run-token-free\.sh/)
  }
})

test('Config publication opts into frozen installs explicitly', async () => {
  const workflow = await readFile('.github/workflows/publish.yml', 'utf8')
  const jsrUses = [
    ...workflow.matchAll(
      /uses: \.\/\.github\/actions\/publish\/jsr\n([\s\S]*?)(?=\n\s+- uses:|\n\s{2}\S|$)/g,
    ),
  ]

  assert.equal(jsrUses.length, 2)
  for (const [, inputs] of jsrUses) assert.match(inputs, /frozen-lockfile: 'true'/)
})
