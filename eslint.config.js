import { createConfig } from './packages/eslint/src/index.js'

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
})
