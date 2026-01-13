# CI Action

Runs CI checks: lint, format, typecheck, test, and build.

## Features

- **Smart build ordering**: Builds packages first by default (essential for monorepos)
- **Configurable**: Enable/disable individual checks
- **Flexible**: Customize commands for any package manager

## Usage

### Basic (Monorepo - builds first)

```yaml
- uses: astrale-os/config/.github/actions/ci@main
```

This will:

1. ✅ Build packages (so inter-package dependencies work)
2. ✅ Run lint
3. ✅ Check formatting
4. ✅ Run typecheck
5. ✅ Run tests

### Single Package (build after checks)

```yaml
- uses: astrale-os/config/.github/actions/ci@main
  with:
    build-first: 'false'
    run-build: 'true'
```

This will:

1. ✅ Run lint
2. ✅ Check formatting
3. ✅ Run typecheck
4. ✅ Run tests
5. ✅ Build packages

### Custom Configuration

```yaml
- uses: astrale-os/config/.github/actions/ci@main
  with:
    build-first: 'true' # Build before checks (default: true)
    run-lint: 'true' # Run linting (default: true)
    run-typecheck: 'true' # Run typecheck (default: true)
    run-test: 'true' # Run tests (default: true)
    run-build: 'false' # Build after checks (default: false, ignored if build-first is true)
    lint-command: 'pnpm lint' # Customize lint command
    typecheck-command: 'pnpm typecheck'
    test-command: 'pnpm test'
    build-command: 'pnpm build'
```

## Why Build First?

In monorepos with inter-package dependencies (e.g., `@org/memory` imports from `@org/core`), TypeScript needs the built output of dependencies to perform type checking.

**Without building first:**

```
typecheck → @org/memory imports @org/core → ❌ Cannot find module '@org/core'
```

**With building first:**

```
build → @org/core dist created → typecheck → @org/memory finds @org/core → ✅
```

## Inputs

| Input                  | Description                     | Default             |
| ---------------------- | ------------------------------- | ------------------- |
| `node-version-file`    | Path to .nvmrc or similar       | `.nvmrc`            |
| `build-first`          | Build before checks (monorepos) | `true`              |
| `run-lint`             | Run ESLint and Prettier         | `true`              |
| `run-typecheck`        | Run TypeScript type checking    | `true`              |
| `run-test`             | Run tests                       | `true`              |
| `run-build`            | Build after checks              | `false`             |
| `lint-command`         | Lint command                    | `pnpm lint`         |
| `format-check-command` | Format check command            | `pnpm format:check` |
| `typecheck-command`    | Typecheck command               | `pnpm typecheck`    |
| `test-command`         | Test command                    | `pnpm test`         |
| `build-command`        | Build command                   | `pnpm build`        |
