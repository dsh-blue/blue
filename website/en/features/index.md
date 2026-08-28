# Features overview

Blue is a Cordis plugin tree. The bundle currently has 30 Blue-owned rows: two host-support rows, eight baseline rows, 15 enhancement rows, and five assembly rows.

## Baseline

`blue-api-host`, `blue-core`, `blue-theme-dark`, `blue-banner`, `blue-transcript`, `blue-status-basic`, `blue-conversation`, and `blue-transcript-official` form the projection-backed renderer baseline. Harness official projections drive the conversation; the TUI no longer folds session events.

## Enhancements

- editor/attachments: `blue-editor-plus`, `blue-attachments`, `blue-paste-image`
- status: cwd, git, mode, title, and context canonical `BlueStatusNode` producers
- bottom panes: activity, queue, todo, btw, and agents canonical `BlueUiNode` producers mounted through private bottom-only composition
- public bridges: the transcript bridge routes third-party status nodes into the footer; core's surface bridge compiles and owns canonical panes and overlays
- status provider owner: selects one exclusive footer provider through `blue.statusProvider`; unselected candidates remain inert
- editor provider owner: selects one exclusive editor shell through `blue.editorProvider`; unselected candidates remain inert

These 15 rows can be removed independently. Diff/terminal/search/read/web tool rendering comes from canonical `ToolPresentationModel` conversion; there are no intent rows.

## plain-first

Baseline plus assembly is the complete, self-sufficient Blue UI. Blue's own enhancements register through the same seams downstream plugins use — drop the whole enhancement segment and the bundle still boots and works. Every enhancement row is thereby held to the test of "is the world better with it", and downstream plugins get mechanism-level parity with built-ins.

## Assembly

`blue-interaction`, `blue-plugin-interaction-bridge`, `blue-startup`, and `blue-app` close the tree with input, commands, notifications, startup, and the Agent driver. App exposes only readonly session readers/projection values and structured actions to renderers.

`blue-context`, `blue-remote`, `blue-openpencil`, and `blue-lark` are validation-only packages, not bundle rows.

## Read on

- [Streaming transcript and tool cards](/en/features/streaming)
- [Input editor](/en/features/editor)
- [Approvals and questionnaires](/en/features/approval)
- [Status bar](/en/features/status-bar)
- [Session modes](/en/features/modes)
- [Bottom panes](/en/features/panes)
