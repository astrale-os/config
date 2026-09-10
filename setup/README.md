# Shared environment setup

Config owns the implementation distributed as a versioned GitHub release archive.
Consumers keep a launcher, a profile and an exact version/SHA-256 in `scripts/setup/`.
Each profile declares the tools, preparation and checks required by its repository.

## Structure and ownership

- `bootstrap/setup.sh`: consumer launcher; downloads and verifies the pinned archive.
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
| `bash scripts/setup/setup.sh verify` | Verify readiness without installation or download |
| `bash scripts/setup/setup.sh artifacts` | Prepare product artifacts without root dependency installation |
| `bash scripts/setup/setup.sh claude` | Run the Claude SessionStart lifecycle |
| `AGENT_SETUP_TOOLS=check bash scripts/setup/setup.sh` | Require existing machine tools; prepare project dependencies |

Codex: disable cache, use `AGENT_HARNESSES=codex bash scripts/setup/setup.sh` as
Setup, leave Maintenance empty. Claude: leave environment Setup empty and invoke
`claude` from SessionStart. Remote hooks lock preparation and rerun when setup inputs
change; otherwise they load paths. Failed preparation leaves no success marker.
Local hooks only load prepared paths. Conductor selects `AGENT_SETUP_TOOLS=check`;
this permits archive/dependency downloads but never installs machine tools.

Bootstrap requires Bash, curl, tar/gzip and sha256sum or shasum, not Node/npm.
Allow GitHub and `release-assets.githubusercontent.com`, plus the package registries
and runtime download hosts used by the enabled tools. Only the verified archive is
cached; each invocation extracts a private copy. Versions never follow `latest` or `main`.

GUI readiness executes Electron's version command and probes three browsers.
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

New profiles must declare their requirements explicitly. Workspace composition
should prepare shared tools once, install its dependency roots, then invoke artifact
steps; it must preserve local changes when selecting subrepository revisions.
