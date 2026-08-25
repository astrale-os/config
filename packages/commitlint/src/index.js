/**
 * Creates a commitlint configuration with custom scopes.
 *
 * Scope and subject-case are ADVISORY (warnings), never hard failures: contributors
 * and AI agents routinely pick a reasonable scope that isn't in the list, or write a
 * subject with a proper noun/acronym (Apache-2.0, GitHub, OIDC). Those should not
 * bounce a commit. Commit TYPE (feat/fix/chore/...) stays enforced — that's what
 * drives changelogs and release-please.
 *
 * @param {Object} [options]
 * @param {string[]} [options.scopes] - Suggested commit scopes for this project (a hint, not a gate)
 * @returns {import('@commitlint/types').UserConfig}
 */
export function createConfig({ scopes = [] } = {}) {
  return {
    extends: ['@commitlint/config-conventional'],
    rules: {
      // Warn (severity 1) on an unlisted scope so commits aren't rejected; if no
      // scopes are supplied, don't check scope at all (severity 0). Scope is optional.
      'scope-enum': [scopes.length ? 1 : 0, 'always', scopes],
      'scope-empty': [0],
      // Keep the lowercase-subject preference as a warning, not a hard failure.
      'subject-case': [1, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
      // Conventional's default cap is 72, which a `fix(scope): …` prefix eats into
      // fast — a precise subject routinely lands just over it and hard-fails the
      // commit. 100 leaves room to say what changed, without inviting essay-titles.
      'header-max-length': [2, 'always', 100],
      'body-max-line-length': [0],
      'footer-max-line-length': [0],
    },
  }
}

export default createConfig
