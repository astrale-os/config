# Shared environment setup

Config owns the implementation distributed as a versioned GitHub release archive.
Consumers keep a launcher, a profile and an exact version/SHA-256 in `scripts/setup/`.
Each profile declares the tools, preparation and checks required by its repository.

## Structure and ownership

- `bootstrap/setup.sh`: consumer launcher; downloads and verifies the pinned archive.
- `astrale-setup`: executable entry point in the Config checkout and the release archive.
- `lib/` and `setup_*.sh`: runtimes, browsers, skills, verification and Claude lifecycle.
- `profiles/`: repository preparation and checks, receiving an explicit checkout path.
- `tests/`: archive integrity, cache, runtime isolation and lifecycle checks.
- `pack.sh` and `package.json`: archive production and version; nothing is published to npm.

Product repositories own their version pins, builds and tests. Profiles call those
commands. Shared downloads are reusable; activation paths remain checkout-specific.

## Consumer contract

`repo.sh` exports `AGENT_SETUP_PROFILE`, `AGENT_SETUP_BROWSER` and
`AGENT_SETUP_ASTRALE_CLI`. `setup.lock` contains `VERSION SHA256` on one line.
Copy `bootstrap/setup.sh` to the consumer's `scripts/setup/setup.sh`.

| Command | Effect |
| --- | --- |
| `bash scripts/setup/setup.sh` | Prepare tools, dependencies and artifacts; verify readiness |
| `astrale-setup REPOSITORY codex` | Prepare and verify a checkout for Codex |
| `astrale-setup REPOSITORY claude` | Run the Claude lifecycle for a checkout |
| `bash scripts/setup/setup.sh verify` | Verify readiness without installation or download |
| `bash scripts/setup/setup.sh artifacts` | Prepare product artifacts without root dependency installation |
| `bash scripts/setup/setup.sh claude` | Run the Claude SessionStart lifecycle |
| `AGENT_SETUP_TOOLS=check bash scripts/setup/setup.sh` | Require existing machine tools; prepare project dependencies |

Preparation defaults to `AGENT_SETUP_CHECKOUT=pinned`. A Workspace initializes missing
submodules at the commits recorded in its checkout and refuses to move existing
submodules. Dependencies in the Workspace root, Domains, GUI and MCP install with
`--frozen-lockfile`; standalone profiles also use their own frozen lockfile.
Use `AGENT_SETUP_CHECKOUT=live` explicitly to refresh Workspace submodules to their
remote main branches and permit lockfile updates.

Codex Cloud can use one Setup command when both repositories are attached:

```bash
/workspace/config/setup/astrale-setup /workspace/workspace codex
```

Select an exact Config revision for a reproducible environment, or use the same
executable from the checksum-verified release archive. The existing
`AGENT_HARNESSES=codex bash scripts/setup/setup.sh` command works once the
consumer pins this version. A consumer using the updated bootstrap can run
`bash scripts/setup/setup.sh codex`. Leave Maintenance empty.

For the integrated checkout mounted directly under `/workspace`, the Codex action
also activates the generated tools in login shells starting at the mount root.
For fresh non-interactive Bash processes, the Codex action generates a `BASH_ENV`
hook that activates the tools under `/workspace`. Pass the hook to the Bash
process from your automation. Codex Cloud reserves `BASH_ENV` in environment
settings. If you override `AGENT_SETUP_HOME`, use `bash-env.sh` in that directory.

```bash
BASH_ENV=/workspace/.astrale-tools/config-runner/bash-env.sh bash -c 'pnpm --version'
```

A consumer can declare `AGENT_CODEX_BUN_VERSION` for an extra `bun-latest` command,
and `AGENT_CODEX_POSTGRES_IMAGE` for a PostgreSQL image pinned by digest, in
`scripts/setup/repo.sh`. Either can be empty. These additions run only for the
`codex` action and reuse tools or images already available.

With Claude Code, leave environment Setup empty and let the existing SessionStart
hook call the consumer bootstrap with `claude`. The hook uses the same preparation.
Remote hooks lock preparation and rerun when setup inputs change; otherwise they
load paths and resume required services. Docker restart reuses its installed
engine without installation or downloads. Failed preparation leaves no success marker.
Local hooks only load prepared paths. If shell profiles are read-only, source the
generated `env.sh` reported by setup. Conductor selects `AGENT_SETUP_TOOLS=check`;
this permits archive/dependency downloads but never installs machine tools.

Bootstrap requires Bash, curl, tar/gzip and sha256sum or shasum, not Node/npm.
Allow GitHub and `release-assets.githubusercontent.com`, plus the package registries
and runtime download hosts used by the enabled tools. Only the verified archive is
cached; each invocation extracts a private copy. Versions never follow `latest` or `main`.

GUI readiness executes Electron's version command and probes three browsers.
Use `AGENT_SETUP_ELECTRON=0` for a headless setup without Electron.
Installation can repair a diagnosed missing GTK 3 library through signed APT;
verification/check mode cannot. Root and GitHub runner probes use `--no-sandbox`;
ordinary local users retain the sandbox. Application display and end-to-end tests
require the product build/start commands and a display or Xvfb.

## Change, validate and release

Run `pnpm test:setup` and the repository CI checks. Test installation on fresh Linux,
reuse, and automatic cloud startup without manually rerunning setup. Readiness does
not imply all product tests pass: record product failures separately in consumer docs.

Increment `package.json`'s version and run `bash setup/pack.sh /tmp/setup-release`.
The **Publish setup archive** workflow on main tests and publishes
`setup-vVERSION` with `astrale-setup-VERSION.tar.gz` and its SHA-256 file as a
prerelease. Never replace an existing tag or asset. Qualify the affected profiles,
then promote the release and update consumer version/digest pairs together.

Profiles implement preflight, artifact preparation and verification. Workspace additionally
selects its checkouts and dependency roots, then calls product artifact functions; it never
runs standalone installers over integrated links. Profile fingerprint/environment extensions
retain provider inputs and non-secret selections. Git fixtures protect local work during refresh.
If a pinned submodule cannot be cloned, setup fails so the environment cannot be
reported as ready. In live mode a refused clone leaves the Workspace partial: tools
are prepared, product dependencies and artifacts are skipped, and the Claude hook
names the missing submodules to attach.
A declared submodule that Workspace preparation does not cover yet is ignored with a
warning (also reported in the Claude hook context) rather than failing setup; every
covered repository must remain declared.
