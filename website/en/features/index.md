# Features overview

Blue is a Cordis plugin tree. The bundle currently has 32 Blue-owned rows: two host-support rows, nine baseline rows, 15 enhancement rows, and six assembly rows.

## Baseline

`blue-api-host`, `blue-locale`, `blue-core`, `blue-theme-dark`, `blue-banner`, `blue-transcript`, `blue-status-basic`, `blue-conversation`, and `blue-transcript-official` form the projection-backed renderer baseline. `blue-locale` follows the system language for English/Simplified Chinese and supports live switching through `/settings`; Harness official projections drive the conversation, and the TUI no longer folds session events.

## Enhancements

- editor/attachments: `blue-editor-plus`, `blue-attachments`, `blue-paste-image`
- status: cwd, git, mode, title, and context canonical `BlueStatusNode` producers
- bottom panes: activity, queue, todo, btw, and agents canonical `BlueUiNode` producers mounted through private bottom-only composition
- public bridges: the transcript bridge routes third-party status nodes into the footer; core's surface bridge compiles and owns canonical panes and overlays
- status provider owner: selects one exclusive footer provider through `blue.statusProvider`; unselected candidates remain inert
- editor provider owner: selects one exclusive editor shell through `blue.editorProvider`; unselected candidates remain inert

These 15 rows can be removed independently. Diff/terminal/search/read/web tool rendering uses canonical `ToolPresentationModel.call/result` nodes compiled directly by core; there are no intent rows or frontend `View` adapters.

## plain-first

Baseline plus assembly is the complete, self-sufficient Blue UI. Blue's own enhancements register through the same seams downstream plugins use — drop the whole enhancement segment and the bundle still boots and works. Every enhancement row is thereby held to the test of "is the world better with it", and downstream plugins get mechanism-level parity with built-ins.

## Assembly

`blue-interaction`, provider/public bridges, `blue-startup`, `blue-app`, and `blue-plugin-session-bridge` close the tree with input, commands, notifications, startup, the Agent driver, and public session capabilities. App exposes only readonly session readers/projection values and narrow structured actions to renderers and third-party facades.

`blue-context`, `blue-remote`, `blue-openpencil`, and `blue-lark` are validation-only packages, not bundle rows.

## Read on

- [Streaming transcript and tool cards](/en/features/streaming)
- [Input editor](/en/features/editor)
- [Approvals and questionnaires](/en/features/approval)
- [Status bar](/en/features/status-bar)
- [Session modes](/en/features/modes)
- [Bottom panes](/en/features/panes)
