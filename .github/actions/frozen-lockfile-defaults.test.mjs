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

  for (const file of actions) {
    const source = await readFile(file, 'utf8')
    const input = source.match(/  frozen-lockfile:\n(?:    .+\n)+?    default: '([^']+)'/)

    assert.equal(input?.[1], 'true', `${file} must default frozen-lockfile to true`)
    if (authenticatedActions.has(file)) {
      assert.match(
        source,
        /run: bash "\$\{\{ github\.action_path \}\}\/\.\.\/install-dependencies\.sh"/,
      )
      assert.match(source, /INSTALL_FROZEN_LOCKFILE: \$\{\{ inputs\.frozen-lockfile \}\}/)
      assert.doesNotMatch(source, /Setup Node\.js \(with registry \+ cache\)/)
      assert.match(
        source,
        /if: inputs\.registry-url == '' && inputs\.token == '' && inputs\.frozen-lockfile == 'true'/,
      )
    } else {
      assert.match(source, /run: pnpm install --frozen-lockfile/)
    }
  }

  assert.match(installer, /install_args\+=\(--frozen-lockfile\)/)
  assert.match(installer, /--ignore-scripts/)
  assert.match(installer, /pnpm -r rebuild --pending/)
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
