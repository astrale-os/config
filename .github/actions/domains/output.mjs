import { appendFile } from 'node:fs/promises'

/** Write scalar strings literally while retaining JSON for structured GitHub Action outputs. */
export async function writeOutput(name, value, file = process.env.GITHUB_OUTPUT) {
  if (!file) return
  const encoded = typeof value === 'string' ? value : JSON.stringify(value)
  await appendFile(file, `${name}=${encoded}\n`)
}
