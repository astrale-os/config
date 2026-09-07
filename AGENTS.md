# Astrale Config

Astrale OS is a graph-based operating system. This autonomous repository is the `config` submodule of the Astrale workspace and owns shared TypeScript, linting, formatting, release, and repository-automation configuration.

## Repository boundaries

- `workspace:*` may reference only packages owned by this repository. Depend on packages owned by another Astrale repository through published versions.
- Use the checked-in package scripts and configuration as the source of truth for tooling and verification.
