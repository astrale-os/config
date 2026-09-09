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
