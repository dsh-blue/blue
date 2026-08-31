# `@dsh-blue/blue-interaction`

Repo-wide rules live in the root [AGENTS.md](../../AGENTS.md). This package is
the TUI interaction adapter over app/frontend contracts; it may use core L1
services but never owns Harness Agent or Session objects.

## Boundary

The parent plugin creates one frontend-tree `EditorHostService` and
`InteractionStateService`, then mounts the built-in command, input, question,
approval, settings, locale, and optional feature children. Mutable editor,
draft, alias, selection, onboarding, and notice state belongs to that tree,
not a module singleton.

All session reads and writes use `blueSessionReader`,
`blueSessionProjections`, `blueSessionActions`, `blueRequests`, or
`blueRetractions`. Panels and public plugin content use canonical
`BlueUiNode`; only core owns terminal rows, width, focus, and key dispatch.

## Ownership

`EditorHostService` owns the single editor engine and a stable outer delegate.
Provider candidates contribute inert shells around that engine; they never own
draft, history, attachments, focus, IME, completion, or submit. Selection is
explicit settings state, activation is atomic, failures retain the current
same-tree last-known-good or restore `blue.default`, and unload restores the
default without rewriting the desired id.

Submit is a pre-clear barrier: capture the draft/attachments, clear the editor,
issue the structured app request, and restore only when rejection still belongs
to that request/session/editor generation. Followup, steer, interrupt,
retraction, session switch, and provider replacement must not let a late
completion overwrite newer user input.

Completion merges built-in slash, file, skill, and extension sources. Public
editor extensions are inert host registrations; this owner supplies bounded
callback context and owns timeout, abort, ordering, stale-result rejection,
submit transforms, and unload. Extension/provider callbacks cannot obtain raw
terminal or session authority.

Commands are registered through the Harness command service and operate through
structured app/frontend actions. Aliases are tree-local and cannot shadow
reserved or already registered commands. Dialogs use package-private canonical
controllers plus one compiler adapter; do not restore the removed public panel
class hierarchy or a second UI vocabulary.

The public plugin bridge owns active command dispatch,
`notifications.publish`, and editor-extension binding. The separate
editor-provider owner controls Experimental provider candidates. Both consume
composition-private `bluePluginControl`; ordinary plugins receive only the
guarded host. Definition buffers replay after an owner gap, but notifications,
gestures, actions, and old callbacks do not.

Optional subpath plugins own editor enhancements, attachments/image paste,
queue/status rows, command-model UI, public bridge, and provider ownership.
`blue-plugin-author-environment` contributes only the installed Node and
plugin-kit executable paths to Harness `shellEnv`, with Fiber-owned cleanup;
the preset author skill must not guess PATH/profile roots.

## Change Rules

- All key handling registers through `blueKeymap`. Modal panels get explicit
  priority/owner scope and must release focus and listeners on close/unload.
- Every async command, completion, provider, question, approval, update, fetch,
  and external-editor operation captures abort plus the relevant tree/session
  generation. Closing or unloading makes later settlements inert.
- Locale changes reproject labels/help/completions/panels in place while
  preserving controller, editor, cursor, draft, and active-operation identity.
  User/domain content and upstream errors are not translated as UI labels.
- Renderer rows use `blueComponents` width helpers and canonical compiler
  output. Queue and editor furniture participate in the owning width scan.
- Plugin installation/update is profile-owned and restart-based. Validate local
  packages through the published plugin kit, normalize them to `file:`
  snapshots, and never hot-replace the active Cordis tree.
- Runtime entries come from package exports. A subpath lifecycle or inject
  change must update its manifest/files, bundle row, direct tests, and this
  ownership description when the boundary changes.

## Verification

Use `pnpm run verify:changed` for focused edits. Editor lifecycle, app-action
boundaries, public bridge, provider owner, subpaths, command registry, locale,
or composition changes require `pnpm run verify:full` and bundle e2e.

Keep tests for submit restoration/fencing, draft/history isolation, completion
ordering/abort, owner gap/replay, provider fallback/breaker/unload, command and
alias conflicts, modal cleanup, locale reprojection, and late settlements.
Content or furniture changes also update `tests/width-scan.spec.ts`; author
environment/authoring workflow changes run
`pnpm run check:plugin-authoring-docs` and
`pnpm run fixture:plugin-tutorial`.
