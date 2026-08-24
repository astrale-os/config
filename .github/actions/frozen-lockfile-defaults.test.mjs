import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const actions = [
  '.github/actions/ci/action.yml',
  '.github/actions/setup/action.yml',
  '.github/actions/publish/jsr/action.yml',
  '.github/actions/publish/npm/action.yml',
]

test('shared install actions default to frozen lockfiles', async () => {
  for (const file of actions) {
    const source = await readFile(file, 'utf8')
    const input = source.match(/  frozen-lockfile:\n(?:    .+\n)+?    default: '([^']+)'/)

    assert.equal(input?.[1], 'true', `${file} must default frozen-lockfile to true`)
    assert.match(source, /run: pnpm install --frozen-lockfile/)
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
