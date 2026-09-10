// Read-only admission of a checkout's prepared native tools; never starts a database.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(process.argv[2] || process.env.AGENT_REPO_ROOT || '.')
const pins = JSON.parse(fs.readFileSync(path.join(root, 'scripts/integration/native-pins.json')))
const directory = path.join(root, '.context/falkordb-native')
const platform = `${process.platform}-${process.arch}`
const modulePin = pins.modules[platform]
if (!modulePin) throw new Error(`Unsupported native platform: ${platform}`)
const sources = JSON.parse(fs.readFileSync(path.join(directory, 'sources.json')))
if (
  JSON.stringify(sources) !== JSON.stringify({ platform, redis: pins.redis, module: modulePin })
) {
  throw new Error(
    'Existing native tools do not match current pins; explicitly replace .context/falkordb-native',
  )
}
for (const [file, digest] of [
  ['redis.tar.gz', pins.redis.sha256],
  ['falkordb.so', modulePin.sha256],
]) {
  const observed = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(directory, file)))
    .digest('hex')
  if (observed !== digest) throw new Error(`Prepared native digest mismatch: ${file}`)
}
const server = path.join(directory, `redis-${pins.redis.version}/src/redis-server`)
fs.accessSync(server, fs.constants.X_OK)
const result = spawnSync(server, ['--version'], { encoding: 'utf8', timeout: 10_000 })
if (result.status !== 0 || !result.stdout.includes(`v=${pins.redis.version} `)) {
  throw new Error(
    `Prepared Redis is not executable at the pinned version: ${result.stderr || result.error || result.stdout}`,
  )
}
console.log(`Native FalkorDB prepared: Redis ${pins.redis.version}, pinned module ${platform}`)
