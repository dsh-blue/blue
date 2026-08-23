# Blue Surface Migration Matrix

This is the F5 control document for the frontend-runtime branch. A row is
complete only after the official consumer, independent fixture, unload/late
result checks, width scan, golden or e2e comparison, bundle composition, and
real-profile acceptance are all recorded. An additive model or registry alone
does not satisfy the row.

| Surface | Current baseline | Frontend model/provider | Renderer consumer | Fallback | Deletion condition |
|---|---|---|---|---|---|
| status | `blueStatus` and footer plugins | status entries and provider views | legacy footer shell; generic `FrontendModelComponent` is available for model fixtures | legacy status row | remove only after every status entry has a model consumer and footer golden parity |
| dock | transcript bottom panes | dock contributions and provider views | legacy `blueScreen.addBottomChild` panes | legacy pane | remove only after fixed ordering, scroll ownership, and mouse/keyboard fixtures pass |
| command/panel | interaction command registry and dialogs | `CommandModel`/`PanelModel` consumers, including context | `FrontendPanel` consumes the official context model; other dialogs remain legacy | `/context` falls back to `InfoPanel`; commands remain available without the optional feature | remove per-dialog legacy mount only after slot replacement, focus restore, and acceptance |
| tool | transcript fold and tool cards | intent/tool presentation models | legacy transcript renderer | generic text result | remove fold-owned renderer only after canonical tool fixtures and unknown-intent fallback pass |
| theme | `blueTheme` semantic registry | theme semantic tokens | core theme compiler | built-in dark theme | remove compatibility token aliases after dark/light/custom and unload fixtures pass |
| editor | shared pi-tui editor and slot replacement | interaction editor seams | legacy editor consumer | plain editor | remove legacy seam only after paste/history/completion/scroll and PTY acceptance |
| transcript | session-event fold and viewport | transcript model work is additive and incomplete | legacy transcript renderer | plain text export/render | remove old renderer only after replay/live/resize/tail-follow and long-session e2e parity |

## Current Evidence

The core model adapter is renderer-neutral and width-bounded. The context
vertical slice now consumes the official four-key projection cut and has an
independent tarball fixture, a real dsh-context 0.25.3 host fixture, a TUI
panel consumer, width scan, and bundle e2e. Its bundle row stays disabled and
it has not replaced `blue-status-context` pending live profile acceptance.
Remote v2 negotiation and lease transport now have a real authenticated
Unix-socket daemon fixture, including two sessions, authorization, response
carriers, contention, release, and late-event cleanup. This is deliberately
not recorded as SSH bootstrap or live-profile acceptance.

The remaining rows intentionally stay on the legacy baseline until their
official consumers and live acceptance are available. This prevents duplicate
mounts and keeps provider failure on the plain fallback path.

## Required Record Per Row

Record the owner, official Harness API or event service, capability probe,
bundle row and disable switch, fixture command, width/golden evidence, unload
result, and the exact legacy deletion condition. A row must name the profile
used for human acceptance; CI success alone cannot satisfy the deletion gate.
