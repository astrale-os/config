import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { INSTALL_PACKUMENT, awaitVisibleVersion, observeVersion } from './registry-visibility.mjs'

const registry = 'https://registry.example'
const name = '@example/domain'
const version = '1.2.3'
const packumentUrl = 'https://registry.example/@example%2fdomain'
const tarballUrl = 'https://registry.example/@example/domain/-/domain-1.2.3.tgz'
const bytes = Buffer.from('published tarball bytes')
const sha512 = (input) => `sha512-${createHash('sha512').update(input).digest('base64')}`
const integrity = sha512(bytes)

// A registry whose packument and tarball answers follow scripted sequences; the last entry
// of a sequence repeats. Packument steps: 'listed', 'unlisted', or an HTTP status. Tarball
// steps: 200, an HTTP status, 'corrupt' (other bytes), 'truncated' (the body fails), or
// 'stall' (spends the observation's whole budget on the fake clock).
function fakeRegistry({ packument = ['listed'], tarball = [200], dist = {} } = {}, clock) {
  const requests = []
  const next = (steps, index) => steps[Math.min(index, steps.length - 1)]
  let packumentIndex = 0
  let tarballIndex = 0
  const request = async (url, init = {}) => {
    requests.push({ url, accept: init.headers?.accept })
    if (url === packumentUrl) {
      const step = next(packument, packumentIndex++)
      if (typeof step === 'number') return new Response('registry answer', { status: step })
      const versions =
        step === 'listed'
          ? { [version]: { dist: { tarball: tarballUrl, integrity, ...dist } } }
          : { '1.2.2': { dist: { tarball: 'https://registry.example/old.tgz', integrity } } }
      return Response.json({ name, versions })
    }
    assert.equal(url, tarballUrl)
    const step = next(tarball, tarballIndex++)
    if (step === 'stall') {
      clock.time += clock.budgets.at(-1)
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }
    if (step === 'corrupt') return new Response(Buffer.from('other bytes'))
    if (step === 'truncated') {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 4))
          controller.error(new TypeError('terminated'))
        },
      })
      return new Response(body)
    }
    return step === 200 ? new Response(bytes) : new Response('missing', { status: step })
  }
  return { request, requests, tarballRequests: () => requests.filter((r) => r.url === tarballUrl) }
}

function fakeClock() {
  const clock = {
    time: 0,
    sleeps: [],
    budgets: [],
    now: () => clock.time,
    sleep: async (milliseconds) => {
      clock.sleeps.push(milliseconds)
      clock.time += milliseconds
    },
    timeout: (milliseconds) => {
      clock.budgets.push(milliseconds)
      return new AbortController().signal
    },
  }
  return clock
}

function wait(script, options = {}) {
  const clock = fakeClock()
  const fake = fakeRegistry(script, clock)
  const logs = []
  const outcome = awaitVisibleVersion({
    name,
    version,
    registry,
    request: fake.request,
    clock,
    log: (line) => logs.push(line),
    ...options,
  })
  return { outcome, clock, fake, logs }
}

test('treats a listed version as visible only once its tarball is served', async () => {
  const { outcome, clock, fake, logs } = wait({ tarball: [404, 404, 200] })

  assert.deepEqual(await outcome, { state: 'visible', tarball: tarballUrl, integrity })
  assert.deepEqual(fake.requests.slice(0, 2), [
    { url: packumentUrl, accept: INSTALL_PACKUMENT },
    { url: tarballUrl, accept: undefined },
  ])
  assert.equal(fake.tarballRequests().length, 3)
  assert.deepEqual(clock.sleeps, [10_000, 10_000])
  assert.match(
    logs[0],
    /^waiting for @example\/domain@1\.2\.3 on https:\/\/registry\.example \(attempt 1\/91, next in 10s, bound 15m\): tarball https:\/\/registry\.example\/@example\/domain\/-\/domain-1\.2\.3\.tgz answered HTTP 404$/u,
  )
  assert.equal(
    logs.at(-1),
    '@example/domain@1.2.3 is installable from https://registry.example after 3 attempts',
  )
})

test('fails closed at once when the served tarball differs from dist.integrity', async () => {
  const { outcome, clock, fake } = wait({ tarball: ['corrupt', 200] })

  await assert.rejects(outcome, {
    message: `@example/domain@1.2.3 tarball ${tarballUrl} hashes to ${sha512(Buffer.from('other bytes'))}, but its packument records ${integrity}`,
  })
  assert.equal(fake.tarballRequests().length, 1)
  assert.deepEqual(clock.sleeps, [])
})

test('fails closed when a listed version records no sha512 integrity', async () => {
  const { outcome, fake } = wait({ dist: { integrity: 'sha1-AAAA' } })

  await assert.rejects(outcome, /records no sha512 dist\.integrity/u)
  assert.equal(fake.tarballRequests().length, 0)
})

test('keeps waiting while the install packument does not list the version', async () => {
  const { outcome, logs } = wait({ packument: [404, 'unlisted', 503, 'listed'] })

  assert.equal((await outcome).state, 'visible')
  assert.match(logs[0], /\(attempt 1\/91, [^)]*\): packument \S+ answered HTTP 404$/u)
  assert.match(logs[1], /\(attempt 2\/91, [^)]*\): packument \S+ does not list 1\.2\.3$/u)
  assert.match(logs[2], /\(attempt 3\/91, [^)]*\): packument \S+ answered HTTP 503$/u)
  assert.match(logs[3], /after 4 attempts$/u)
})

test('keeps waiting when a tarball answers HTTP 200 but its download fails', async () => {
  const { outcome, logs } = wait({ tarball: ['truncated', 200] })

  assert.equal((await outcome).state, 'visible')
  assert.match(logs[0], /answered HTTP 200 but the download failed \(terminated\)$/u)
})

test('waits fifteen minutes at ten-second intervals by default, then fails closed', async () => {
  const { outcome, clock, fake } = wait({ tarball: [404] })

  await assert.rejects(
    outcome,
    /^Error: npm tarball for @example\/domain@1\.2\.3 is not installable after 15 minutes: https:\/\/registry\.example\/@example\/domain\/-\/domain-1\.2\.3\.tgz last answered HTTP 404\.$/u,
  )
  assert.equal(fake.tarballRequests().length, 91)
  assert.deepEqual(clock.sleeps, Array(90).fill(10_000))
  assert.equal(clock.time, 15 * 60_000)
})

test('reports a version the packument never lists as not registry-visible', async () => {
  const { outcome } = wait({ packument: ['unlisted'] }, { timeoutMinutes: 1 })

  await assert.rejects(
    outcome,
    /^Error: npm immutable version @example\/domain@1\.2\.3 is not registry-visible after 1 minutes: packument \S+ does not list 1\.2\.3\.$/u,
  )
})

test('bounds the wait by elapsed time when tarball downloads stall', async () => {
  const { outcome, clock } = wait({ tarball: ['stall'] }, { timeoutMinutes: 2 })

  // A stalled download spends its whole budget: 60 s, a 10 s pause, then the last 50 s.
  await assert.rejects(
    outcome,
    /not installable after 2 minutes: \S+ last gave no HTTP response \(timed out\)\.$/u,
  )
  assert.deepEqual(clock.budgets, [60_000, 50_000])
  assert.deepEqual(clock.sleeps, [10_000])
  assert.equal(clock.time, 120_000)
})

test('rejects a bound outside one to sixty whole minutes', async () => {
  for (const timeoutMinutes of [0, 61, 1.5]) {
    const { outcome } = wait({}, { timeoutMinutes })
    await assert.rejects(outcome, /timeoutMinutes must be a whole number between 1 and 60/u)
  }
})

test('observes absence once, without reading a tarball', async () => {
  const fake = fakeRegistry({ packument: [404] })
  const observation = await observeVersion({ name, version, registry, request: fake.request })

  assert.equal(observation.state, 'absent')
  assert.deepEqual(fake.requests, [{ url: packumentUrl, accept: INSTALL_PACKUMENT }])
})
