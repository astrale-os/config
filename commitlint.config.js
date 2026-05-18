import { createConfig } from './packages/commitlint/src/index.js'

export default createConfig({
  scopes: ['commitlint', 'ox', 'renovate', 'typescript', 'ci', 'deps'],
})
