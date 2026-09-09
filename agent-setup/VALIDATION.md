# Unified setup pilot — Config and SDK

The unified `scripts/setup/` layout and `AGENT_SETUP_TOOLS=check|install` policy
are implemented first in Config and SDK. Existing consumers remain pinned to the
previous standard until individually migrated.

Validation on 2026-09-09:

- 27 shared + Config + SDK setup tests passed on Ubuntu 24.04, including local
  tool-policy checks and Claude initialization/reuse/retry fixtures.
- Real preparation and readiness passed for Config and SDK in a fresh Ubuntu
  24.04 ARM64 container, followed by another preparation/readiness in check mode.
- SDK's msgpackr native prebuilt loading initially failed on Node 26; its existing
  installation fallback successfully compiled the native module (gyp exit 0).
- Real local Config preparation passed on macOS using existing tools.
- Config lint and typecheck passed. This does not certify all SDK application tests.
- Shared-copy conformity and shell syntax checks passed.

Publication must coordinate the renamed entry points with cloud environment Setup
commands. Real Codex/Claude validation of the unified revision is still pending;
earlier cloud validations concern the previous layout, not this pilot revision.
No Kernel changes or Workspace submodule pointer updates belong to this pilot.

## Standalone rollout

Published PRs: [Config #52](https://github.com/astrale-os/config/pull/52),
[SDK #478](https://github.com/astrale-os/sdk/pull/478),
[Domains #227](https://github.com/astrale-os/domains/pull/227),
[Shell #218](https://github.com/astrale-os/shell/pull/218),
[Admin #277](https://github.com/astrale-os/admin/pull/277),
[CLI #461](https://github.com/astrale-os/cli/pull/461),
[Datastore #57](https://github.com/astrale-os/datastore/pull/57),
[GUI #39](https://github.com/astrale-os/gui/pull/39),
[UI #174](https://github.com/astrale-os/ui/pull/174), and
[Prototype #15](https://github.com/astrale-os/prototype/pull/15).
Kernel and Workspace are excluded.

102 shared/consumer setup tests passed on Ubuntu 24.04. All eight repositories
passed dependency installation, lint and typecheck in isolated local worktrees.
Admin’s typecheck required permission to open Wrangler’s local port and write
logs; its dry-run did not deploy a Worker. Local UI preparation/build also passed
with the separately pinned Domain pnpm already available and downloads disabled.

The setup CI checks pass. CLI’s separate provider/consumer contract job encountered
the pre-existing pnpm 12.3.1 minimum-release-age restriction; the setup migration
does not relax that policy. Datastore’s separate Claude review job initially failed
at agent startup before reviewing code; application and setup CI passed. These are
reported separately from readiness validation. Real cloud session probes of the
new unified revision remain separate from changing environment Setup commands.
