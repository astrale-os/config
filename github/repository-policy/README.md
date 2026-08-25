# Repository merge policy

`policy.json` is the authoritative merge policy for Astrale repositories that use Release Please.
It makes one pull request one release unit:

- only squash merging is enabled;
- the squash commit title is the pull request title;
- the squash commit body is blank, so branch commit messages cannot become duplicate release notes;
- merged branches are deleted to prevent reused squash branches from carrying old commits forward.

Pull request titles must remain valid Conventional Commit headers because Release Please derives the
release type and changelog entry from the resulting squash commit.

## Check and apply

Authenticate `gh` as an administrator of every declared repository, then run:

```bash
pnpm github:repositories:check
pnpm github:repositories:apply
pnpm github:repositories:check
```

Check mode is read-only and exits non-zero when any managed setting has drifted. Apply mode patches
only the six settings declared in `policy.json`, then reads every repository again and fails if the
result is not converged.

This module deliberately does not manage branch or organization rulesets. Existing rulesets differ
between repositories, and organization rulesets require separate organization-administration
authority. Consolidating them is a distinct migration that must first inventory bypass actors,
required checks, review policy, and release automation.
