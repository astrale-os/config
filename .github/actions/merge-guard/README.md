# Merge Guard Action

Enforces merge order across polyrepo workspaces. Blocks PRs if dependency repos have open PRs on the same branch.

## Why?

In a polyrepo setup, a feature might span multiple repos:
- `kernel` (core types)
- `shell` (depends on kernel)
- `gui` (depends on shell)

If you merge `gui` before `kernel`, the published package will reference types that don't exist yet.

## Usage

### Option A: Direct action (recommended)

```yaml
jobs:
  merge-guard:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: astrale-os/config/.github/actions/merge-guard@main
        with:
          github-token: ${{ github.token }}
          dependencies: '["kernel"]'
```

### Option B: Reusable workflow

```yaml
jobs:
  merge-guard:
    uses: astrale-os/config/.github/workflows/merge-guard.yml@main
    with:
      dependencies: '["kernel"]'
```

## Dependency Map

| Repo | Dependencies |
|------|--------------|
| `kernel` | `[]` (none) |
| `typegraph` | `[]` |
| `datastore` | `[]` |
| `adapters` | `["kernel", "typegraph"]` |
| `shell` | `["kernel"]` |
| `sdk` | `["kernel", "shell"]` |
| `gui` | `["kernel", "shell"]` |
| `backoffice` | `["kernel", "datastore"]` |
| `cli` | `["kernel", "sdk"]` |
| `distribution` | `["kernel", "shell", "sdk"]` |

## How It Works

1. Gets the PR branch name (e.g., `feat/add-wallet`)
2. For each dependency repo, checks if there's an open PR with the same branch name
3. If found → blocks merge with clear message showing which PRs to merge first
4. If not found → allows merge

## Example Output (Blocked)

```
╔════════════════════════════════════════════════════════════╗
║  MERGE BLOCKED - Dependency PRs must be merged first       ║
╚════════════════════════════════════════════════════════════╝

Open PRs on branch 'feat/add-wallet':
  - kernel: https://github.com/astrale-os/kernel/pull/42
  - shell: https://github.com/astrale-os/shell/pull/18

Merge these PRs first, then re-run this check.
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token (use `${{ github.token }}`) | required |
| `dependencies` | JSON array of repo names to check | `[]` |
| `org` | GitHub organization name | `astrale-os` |
