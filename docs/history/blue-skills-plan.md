# Plugin Skills Consolidation

This historical note records why Blue removed its repository-local maintainer
skills and retained only the skills shipped with the `blue-cordis` preset.

The former `.agents/skills/plugin-development`, `plugin-migration`,
`plugin-fixture`, and `plugin-validation` entries mixed three audiences:

- Blue maintainers, whose repository boundaries and verification rules belong
  in root/package `AGENTS.md` and deterministic scripts;
- preset users creating temporary process-local Cordis prototypes;
- external plugin authors building or migrating durable packages without a
  Blue checkout.

The repository-local entries also repeated validator and fixture command
behavior. They were removed rather than replaced with another catch-all skill.
Blue maintainers now follow `AGENTS.md`, the owning package instructions, and
`pnpm run verify:changed`; release or broad changes use
`pnpm run verify:full`.

The `blue-cordis` preset continues to ship three audience-specific skills:

| Skill | Scope |
| --- | --- |
| `cordis-plugin-development` | Inspect, define, run, iterate, and roll back an ephemeral runtime prototype. |
| `blue-plugin-development` | Create or migrate a durable external Blue plugin through the installed catalog, generator, validator, and conformance runner. |
| `editing-cordis-compositions` | Create or edit user-owned presets and composition rows without mutating shipped presets. |

The durable author skill absorbs legacy plugin migration because creation and
migration share the same public capability catalog, package boundary, and
packed-install acceptance contract. Static validation and packed fixtures stay
commands, not standalone skills.
