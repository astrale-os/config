/**
 * Creates a commitlint configuration with custom scopes.
 *
 * @param {Object} options
 * @param {string[]} options.scopes - Allowed commit scopes for this project
 * @returns {import('@commitlint/types').UserConfig}
 */
export function createConfig({ scopes }) {
  return {
    extends: ['@commitlint/config-conventional'],
    rules: {
      'scope-enum': [2, 'always', scopes],
      'scope-empty': [0],
      'body-max-line-length': [0],
      'footer-max-line-length': [0],
    },
  }
}

export default createConfig
