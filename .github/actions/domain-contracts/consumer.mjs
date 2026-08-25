import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CONSUMER_PROBE =
  "const root = await import(process.argv[1]); if (!Object.hasOwn(root, 'schema')) throw new Error('root export has no schema'); const metadata = await import(`${process.argv[1]}/package.json`, { with: { type: 'json' } }); if (metadata.default.name !== process.argv[1]) throw new Error('package metadata identity mismatch')"

export async function writeContractConsumer({ directory, name, dependency, overrides = {} }) {
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        packageManager: 'pnpm@11.13.1',
        dependencies: { [name]: dependency },
        devDependencies: { typescript: '7.0.2' },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(join(directory, 'index.ts'), `import { schema } from '${name}'\nvoid schema\n`)
  await writeFile(
    join(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        files: ['index.ts'],
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
