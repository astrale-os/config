// Registry visibility of a published version: the one definition every publication step
// waits on before it relies on that version.
//
// A version is visible once it is installable: the registry's install packument (the
// abbreviated document package managers resolve through) lists it, the registry serves the
// complete `dist.tarball`, and the served bytes hash to the sha512 that `dist.integrity`
// records. npm acknowledges a publish, then lists the version, then serves its tarball, each
// minutes apart; a listing alone is not installable.

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const INSTALL_PACKUMENT =
  'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'

const OBSERVATION_LIMIT_MS = 60_000

export const systemClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  timeout: (milliseconds) => AbortSignal.timeout(milliseconds),
}

/**
 * Observes `name@version` once on `registry`. Returns one state:
 * - `absent`: the install packument does not list the version;
 * - `pending`: the version is listed but its tarball is not served completely yet, or the
 *   registry gave no usable answer (`tarball` and `answer` are set once the tarball is known);
 * - `visible`: the tarball is served and matches `dist.integrity`.
 * Throws when the registry contradicts itself: a listed version without a tarball URL or a
 * sha512 integrity, or a served tarball whose sha512 differs from `dist.integrity`. These are
 * not propagation delays, so no wait admits them.
 */
export async function observeVersion({
  name,
  version,
  registry,
  request = globalThis.fetch,
  signal = AbortSignal.timeout(OBSERVATION_LIMIT_MS),
}) {
  const spec = `${name}@${version}`
  const packument = `${registry.replace(/\/+$/u, '')}/${name.replaceAll('/', '%2f')}`
  let document
  try {
    const response = await request(packument, { headers: { accept: INSTALL_PACKUMENT }, signal })
    if (!response.ok) {
      await discard(response)
      const reason = `packument ${packument} answered HTTP ${response.status}`
      return { state: response.status === 404 ? 'absent' : 'pending', reason }
    }
    document = await response.json()
  } catch (error) {
    return { state: 'pending', reason: `packument ${packument} gave no answer (${cause(error)})` }
  }

  const entry = document?.versions?.[version]
  if (entry === undefined) {
    return { state: 'absent', reason: `packument ${packument} does not list ${version}` }
  }
  const tarball = entry.dist?.tarball
  if (typeof tarball !== 'string' || !/^https?:\/\//u.test(tarball)) {
    throw new Error(`${spec} has no tarball URL in its packument ${packument}`)
  }
  const recorded = String(entry.dist.integrity ?? '')
    .split(/\s+/u)
    .filter((hash) => hash.startsWith('sha512-'))
  if (recorded.length === 0) {
    throw new Error(`${spec} records no sha512 dist.integrity, so its tarball cannot be verified`)
  }

  const pending = (answer) => ({
    state: 'pending',
    tarball,
    answer,
    reason: `tarball ${tarball} ${answer}`,
  })
  let response
  try {
    response = await request(tarball, { signal })
  } catch (error) {
    return pending(`gave no HTTP response (${cause(error)})`)
  }
  if (response.status !== 200) {
    await discard(response)
    return pending(`answered HTTP ${response.status}`)
  }
  let bytes
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    return pending(`answered HTTP 200 but the download failed (${cause(error)})`)
  }
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (!recorded.includes(integrity)) {
    throw new Error(
      `${spec} tarball ${tarball} hashes to ${integrity}, but its packument records ${recorded.join(' ')}`,
    )
  }
  return { state: 'visible', tarball, integrity }
}

/**
 * Waits until `name@version` is visible on `registry`, within `timeoutMinutes` of elapsed
 * time: one immediate observation, then one after each `delaySeconds` pause. Each observation
 * is capped to a minute and to the time left, and the wait stops once the bound is spent.
 * Returns the visible observation. Throws when the bound is spent, or at once when an
 * observation fails closed.
 */
export async function awaitVisibleVersion({
  name,
  version,
  registry,
  timeoutMinutes = 15,
  delaySeconds = 10,
  attempts = delaySeconds > 0 ? Math.floor((timeoutMinutes * 60) / delaySeconds) + 1 : 1,
  request = globalThis.fetch,
  clock = systemClock,
  log = console.log,
}) {
  wholeNumber('timeoutMinutes', timeoutMinutes, 1, 60)
  wholeNumber('delaySeconds', delaySeconds, 0, 3_600)
  wholeNumber('attempts', attempts, 1, Number.MAX_SAFE_INTEGER)
  const spec = `${name}@${version}`
  const deadline = clock.now() + timeoutMinutes * 60_000
  let observation
  for (let attempt = 1; ; attempt += 1) {
    const budget = Math.max(1_000, Math.min(OBSERVATION_LIMIT_MS, deadline - clock.now()))
    observation = await observeVersion({
      name,
      version,
      registry,
      request,
      signal: clock.timeout(budget),
    })
    if (observation.state === 'visible') {
      if (attempt > 1) log(`${spec} is installable from ${registry} after ${attempt} attempts`)
      return observation
    }
    const remaining = deadline - clock.now()
    if (attempt >= attempts || remaining <= 0) break
    const pause = Math.min(delaySeconds * 1_000, remaining)
    log(
      `waiting for ${spec} on ${registry} (attempt ${attempt}/${attempts}, next in ${Math.ceil(pause / 1_000)}s, bound ${timeoutMinutes}m): ${observation.reason}`,
    )
    await clock.sleep(pause)
  }
  throw new Error(
    observation.tarball === undefined
      ? `npm immutable version ${spec} is not registry-visible after ${timeoutMinutes} minutes: ${observation.reason}.`
      : `npm tarball for ${spec} is not installable after ${timeoutMinutes} minutes: ${observation.tarball} last ${observation.answer}.`,
  )
}

async function discard(response) {
  await response.body?.cancel().catch(() => {})
}

function cause(error) {
  if (error?.name === 'TimeoutError') return 'timed out'
  const code = error?.cause?.code
  const message = String(error?.message ?? error)
  return code ? `${message}: ${code}` : message
}

function wholeNumber(label, value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be a whole number between ${minimum} and ${maximum}`)
  }
}

// An unset or empty variable takes the default, as `${NAME:-default}` does in the publisher.
function environmentNumber(name, fallback) {
  const input = process.env[name]
  if (input === undefined || input === '') return fallback
  if (!/^\d+$/u.test(input)) throw new RangeError(`${name} must be a whole number`)
  return Number(input)
}

// Command line for the bash publisher: waits for `<name> <version>` on `<registry>` with the
// publication bound, logs progress to stderr, and on failure prints the reason to stdout and
// exits 1. VERSION_VERIFY_ATTEMPTS and VERSION_VERIFY_DELAY_SECONDS keep tests instant.
async function main() {
  const [name, version, registry] = process.argv.slice(2)
  if (!name || !version || !registry) {
    throw new Error('Usage: registry-visibility.mjs <name> <version> <registry>')
  }
  await awaitVisibleVersion({
    name,
    version,
    registry,
    timeoutMinutes: environmentNumber('REGISTRY_VISIBILITY_TIMEOUT_MINUTES', 15),
    delaySeconds: environmentNumber('VERSION_VERIFY_DELAY_SECONDS', 10),
    attempts: environmentNumber('VERSION_VERIFY_ATTEMPTS', undefined),
    log: (line) => console.error(line),
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stdout.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
