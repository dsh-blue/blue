# `@dsh-blue/blue-interaction`

Interaction owns the Blue editor, built-in command UX, dialogs, approval and
question surfaces, interaction state, and editor-extension execution.

Commands register directly with native `ctx.commands`. Domain reads and
writes use the exact `blueCurrentAgent.current()` Agent plus native dsh
services such as `sessionProjections`, `commands`, `tools`, `settings`,
`skills`, and `sessionController`. Do not introduce an app action/reader
facade or copy Agent/session state into a second mutable model. Cross-realm
session state such as plan mode is read from native root projections and
changed through native commands; a selected Agent's private Cordis realm is
not a stable discovery path for Blue.

Queue panes register with `bluePanes`; mode status registers with
`blueStatus`; public editor extensions are consumed from
`blueEditorExtensions`. Core-owned `blueScreen` overlays remain appropriate
for internal dialogs that require concrete editor/focus behavior. External
overlay contributions use `blueOverlays`.

`/jobs` reads, kills, and subscribes through the native `jobs` registry for
the exact current Agent; output is consumed only by explicit Enter. `/agents`
lists native `subagents`, enriches resident rows from native Sessions and
projections, and owns its temporary child attach view. Attach does not change
the selected Agent or publish a service; it aborts pending reads, follow-ups,
listeners, timers, and transcript renderers on close, Agent replacement, or
Fiber unload.

Async extension callbacks are bounded, abortable, generation-fenced, and
validated before applying completion/submit/event output. Unload aborts work
and disposes all registrations. There is one Blue-owned editor engine; do not
restore editor providers, status providers, candidate selection, host bridges,
plugin catalog commands, or plugin author environment wiring.

Editor-extension before/after nodes remain deliberately lightweight and do
not admit `document` or `chart`; rich terminal content belongs to pane and
overlay trees.

Command, editor, dialog, callback, lifecycle, or width changes require the
owning suites and width scan, bundle e2e, `pnpm run verify:full`, and
dedicated-profile acceptance.
