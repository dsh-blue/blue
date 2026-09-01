# Features overview

Blue `0.2.0-alpha.1` is a flat Cordis plugin tree over `dsh-base`. The
bundle inserts six dsh support rows and 30 Blue rows.

## Data and interaction

- native Harness `sessionProjections` drive conversation, token/context,
  title, and session facts;
- built-in commands register directly on native `commands`;
- app selects the current Agent and exposes its exact identity through
  `blueCurrentAgent`;
- transcript and interaction do not maintain a second Agent/Session truth.

## Terminal UI

- core is the only pi-tui/raw-terminal owner;
- status producers register directly on `blueStatus`;
- activity, queue, todo, BTW, Agent, and workflow panes register on `bluePanes`;
- the jobs footer, `/jobs`, and `/agents` consume native Harness services;
- `blueOverlays` renders overlay contributions;
- `blueEditorExtensions` composes extensions around the one Blue editor.

External plugins and built-ins use the same services and Fiber lifecycle.

## Continue

- [Streaming transcript and tool cards](/en/features/streaming)
- [Input editor](/en/features/editor)
- [Approvals and questionnaires](/en/features/approval)
- [Status bar](/en/features/status-bar)
- [Session modes](/en/features/modes)
- [Bottom panes](/en/features/panes)
