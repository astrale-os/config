import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CONSUMER_PROBE =
  "const root = await import(process.argv[1]); if (root === null || typeof root !== 'object') throw new Error('Domain root import did not return a module namespace')"

export async function writeDomainConsumer({ directory, name, dependency, overrides = {} }) {
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        packageManager: 'pnpm@12.0.0',
        dependencies: { ...overrides, [name]: dependency },
      },
      null,
      2,
    )}\n`,
  )
  if (Object.keys(overrides).length > 0) {
    const lines = ['overrides:']
    for (const [packageName, value] of Object.entries(overrides).sort()) {
      lines.push(`  ${JSON.stringify(packageName)}: ${JSON.stringify(value)}`)
    }
    await writeFile(join(directory, 'pnpm-workspace.yaml'), `${lines.join('\n')}\n`)
  }
}
