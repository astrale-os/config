function parse(version) {
  const match = String(version)
    .trim()
    .match(
      /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u,
    )
  if (!match) throw new Error(`Invalid semantic version: ${version}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4],
  }
}

function compare(left, right) {
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
  }
  if (left.pre === right.pre) return 0
  if (left.pre === undefined) return 1
  if (right.pre === undefined) return -1
  const a = left.pre.split('.')
  const b = right.pre.split('.')
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1
    if (b[index] === undefined) return 1
    if (a[index] === b[index]) continue
    const an = /^\d+$/u.test(a[index]) ? Number(a[index]) : undefined
    const bn = /^\d+$/u.test(b[index]) ? Number(b[index]) : undefined
    if (an !== undefined && bn !== undefined) return an < bn ? -1 : 1
    if (an !== undefined) return -1
    if (bn !== undefined) return 1
    return a[index] < b[index] ? -1 : 1
  }
  return 0
}

function tuple(major, minor = 0, patch = 0) {
  return { major, minor, patch, pre: undefined }
}

function comparator(operator, expected) {
  return (actual) => {
    const result = compare(actual, expected)
    return operator === '>'
      ? result > 0
      : operator === '>='
        ? result >= 0
        : operator === '<'
          ? result < 0
          : operator === '<='
            ? result <= 0
            : result === 0
  }
}

function tokenPredicates(token) {
  if (token === '' || token === '*' || /^x$/iu.test(token)) return []
  const operator = token.match(/^(<=|>=|<|>|=|\^|~)?/u)[0] || '='
  const raw = token.slice(operator === '=' && !token.startsWith('=') ? 0 : operator.length)
  const parts = raw.split('.')
  const wildcard = parts.findIndex((part) => /^(?:x|\*)$/iu.test(part))
  const partial = wildcard === -1 ? parts.length : wildcard

  if (wildcard !== -1 || parts.length < 3) {
    const major = partial > 0 ? Number(parts[0]) : 0
    const minor = partial > 1 ? Number(parts[1]) : 0
    if (!Number.isInteger(major) || !Number.isInteger(minor))
      throw new Error(`Invalid range: ${token}`)
    const lower = tuple(major, minor, 0)
    const upper = partial <= 1 ? tuple(major + 1) : tuple(major, minor + 1)
    if (operator === '>') return [comparator('>=', upper)]
    if (operator === '>=') return [comparator('>=', lower)]
    if (operator === '<') return [comparator('<', lower)]
    if (operator === '<=') return [comparator('<', upper)]
    if (operator === '^') {
      const caretUpper =
        major > 0 ? tuple(major + 1) : minor > 0 ? tuple(0, minor + 1) : tuple(0, 0, 1)
      return [comparator('>=', lower), comparator('<', caretUpper)]
    }
    return [comparator('>=', lower), comparator('<', upper)]
  }

  const expected = parse(raw)
  if (operator === '^') {
    const upper =
      expected.major > 0
        ? tuple(expected.major + 1)
        : expected.minor > 0
          ? tuple(0, expected.minor + 1)
          : tuple(0, 0, expected.patch + 1)
    return [comparator('>=', expected), comparator('<', upper)]
  }
  if (operator === '~') {
    return [comparator('>=', expected), comparator('<', tuple(expected.major, expected.minor + 1))]
  }
  return [comparator(operator, expected)]
}

function setSatisfies(version, range) {
  const hyphen = range.match(/^\s*(\S+)\s+-\s+(\S+)\s*$/u)
  const tokens = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : range.trim().split(/\s+/u)
  const predicates = tokens.flatMap(tokenPredicates)
  if (!predicates.every((predicate) => predicate(version))) return false
  if (version.pre === undefined) return true
  return tokens.some((token) => {
    const raw = token.replace(/^(?:<=|>=|<|>|=|\^|~)/u, '')
    try {
      const comparatorVersion = parse(raw)
      return (
        comparatorVersion.pre !== undefined &&
        comparatorVersion.major === version.major &&
        comparatorVersion.minor === version.minor &&
        comparatorVersion.patch === version.patch
      )
    } catch {
      return false
    }
  })
}

export function satisfies(version, range) {
  const parsed = parse(version)
  if (typeof range !== 'string' || range.trim() === '')
    throw new Error(`Invalid semantic-version range: ${range}`)
  if (/^(?:workspace:|file:|link:|git\+|https?:)/u.test(range)) {
    throw new Error(`Domain dependency must use a published semver range: ${range}`)
  }
  return range.split('||').some((set) => setSatisfies(parsed, set))
}
