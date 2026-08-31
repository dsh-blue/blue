# `@dsh-blue/blue`

Repo-wide rules live in the root [AGENTS.md](../../../AGENTS.md). This package
is the installable composition; its module entry owns no product behavior.

## Boundary

`cordis.patch.yml` explicitly composes host support, a private runtime group,
baseline product rows, optional enhancements, and assembly rows. Runtime
behavior stays in owning packages. Validation-only context, remote,
OpenPencil, and Lark adapters remain outside both the bundle dependency and
row closure.

`blue-runtime-private` isolates `bluePluginControl` and raw app
reader/projection/action backing services. Ordinary siblings and dynamic
creative children may inherit only the guarded public `bluePluginHost` facade.
Adding any `blue*` Context service requires deciding whether it belongs in the
private isolate or an explicit public allowlist; the bundle drift tests enforce
that decision.

## Composition Ownership

Cordis sibling rows mount concurrently. Every ordering requirement is an
explicit row/plugin `inject`, never an assumption about YAML position. Public
definition registries are host-buffered across frontend owner boot gaps;
transient overlays, notifications, actions, and gestures still require their
live owner. Bundle fixture wrappers mirror source inject lists exactly.

Baseline owns the public API host, locale, core/theme, banner, conversation
projection, transcript model/status owners, and official transcript consumer.
Enhancement rows add editor/attachment helpers, status producers, Blue-owned
bottom panes, public status bridge, and the reference status-provider owner.
Assembly owns interaction, the editor-provider owner, public interaction
bridge, startup/app, and the app-owned public session bridge. The latter waits
for API control plus app reader/projection sources before exposing readonly
`session.read` and `session.projections.read`; generic public `session.act`
remains absent.

The title behavior is a deliberate pair: disable the base first-prompt title
row, mount Harness's all-prompts provider with the same policy, and retain the
app cadence bridge until upstream observes the opening human message on every
turn. Move or retire both halves together and prove behavior in whole-tree
tests.

Bottom-pane priorities and explicit dependencies preserve activity, queue,
todo, BTW, agents, then editor behavior under scarce height. The queue never
claims editor history keys. Provider candidate rows are inert; persisted user
selection, frontend-tree owners, and default fallback control activation.

## Preset And Skills

The bundle adds one preset root, `blue-cordis`, alongside upstream Harness
presets. Do not copy, alias, shadow, or edit upstream preset directories. The
thin-host disable list follows the upstream web composition and is guarded
against both missing base ids and silent upstream drift. The host runner lives
inside `blue-creative-host`; browser/client dynamic code has no Blue surface.

The preset ships exactly three audience-specific skills:

| Skill | Use |
| --- | --- |
| `cordis-plugin-development` | Temporary process-local inspect/define/run/update/rollback prototypes |
| `blue-plugin-development` | Durable external plugin creation, extension, or legacy migration after explicit persistence choice |
| `editing-cordis-compositions` | User-owned preset and composition editing |

None is a Blue repository-maintainer skill. Dynamic prototyping does not
authorize package creation; local persistence does not authorize GitHub/npm;
and changes to Blue or its bundled preset follow repository/package
`AGENTS.md`. The author skill invokes the installed plugin kit through the
`DSH_BLUE_PLUGIN_NODE`/`DSH_BLUE_PLUGIN_BIN` facts provided by interaction,
never ambient PATH or a checkout.

## Change Rules

- Patch values using `!!js` are executable code. Keep them minimal and update
  inject/order/drift assertions with every row change.
- New public features require the API owner, an official consumer, lifecycle
  tests, a bundle row, capability-absent behavior, and whole-tree evidence.
  Owner-only services are not fallback routes for external plugins.
- Preset payload is immutable installed product data. User-owned compositions
  layer after Blue instead of modifying this patch or a shipped preset.
- Product dependencies use `workspace:*` in the repository and become exact
  versions when packed. A development install links the complete release
  closure; independent plugins use profile-owned `file:` snapshots.
- Runtime JS/type entries come from package exports. The tarball must include
  `cordis.patch.yml` and only the intended `blue-cordis` preset payload.
- Keep plugin-validator process tests as the negative corpus for static and
  packed runners. A helper-only assertion does not prove JSON envelope,
  timeout, cleanup, native ESM, or script-disabled packing behavior.

## Verification

Any patch, preset, skill, dependency, row inject, private-isolate, or package
surface change requires `pnpm run verify:full`. Also run
`pnpm run check:pack`, `pnpm run check:plugin-authoring-docs`,
`pnpm run fixture:plugin-tutorial`, and the relevant preset/bundle e2e tests.
Skill edits must keep valid frontmatter, task-specific routing, and realistic
eval cases.

Install into a dedicated worktree profile with `script/install-dev.sh`, run a
pseudo-TTY smoke, and obtain live human acceptance before merge. Whole-tree
tests cover real Loader composition with only the model and process terminal
substituted; they do not replace the real profile gate. Canonical dialog e2e
must exercise the real provider-add wizard: Enter confirms each text field
before advancing, while Up/Down remains editor-owned during editing.
