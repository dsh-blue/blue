# Features overview

Blue is not one big component — it is a **Cordis plugin tree**: the bundle's `cordis.patch.yml` assembles the UI over `dsh-base` with 23 plugin rows. Every visual surface is an individually removable row; that is "everything is a plugin" taken literally.

## Three-segment assembly

### Baseline segment (5 rows) — plain Blue

The minimal, self-sufficient Blue UI that remains when the whole enhancement segment is dropped:

| Row | Responsibility |
| --- | --- |
| `blue-core` | the tree's only pi-tui adapter: terminal lifecycle plus the `blueScreen` / `blueKeymap` / `blueTerminalInfo` / `blueComponents` services |
| `blue-theme-dark` | built-in dark palette, providing `blueTheme` |
| `blue-banner` | boot welcome banner: the logo-headed welcome/`/help` lines and the Directory/Model/Version rows |
| `blue-transcript` | session events → transcript rendering; the `blueStatus` registry and two-row footer shell |
| `blue-status-basic` | baseline footer entry: the model name (priority 0, brightest tier) |

### Enhancement segment (15 rows) — droppable wholesale

Optional layers over the plain baseline; each row deletes individually, the whole segment deletes together:

| Row | Responsibility |
| --- | --- |
| `blue-editor-plus` | `!` bash mode + slash/`@` autocomplete |
| `blue-attachments` | attachment store (filesystem image library) |
| `blue-paste-image` | Ctrl-V clipboard paste (`Alt-V` too on Windows), `[image #N]` markers |
| `blue-status-cwd` | footer: session working directory (priority 5) |
| `blue-status-git` | footer: git badge `branch [+a -d ↑u↓v]` (priority 10) |
| `blue-status-mode` | footer: session-mode badge `plan`/`yolo` (priority 2, hidden in normal) |
| `blue-status-title` | footer: session title (priority 30, row 1 right-aligned) |
| `blue-status-context` | footer: context occupancy (priority 20, row 2 right-aligned) |
| `blue-intent-diff` | dedicated diff tool card |
| `blue-intent-terminal` | dedicated terminal-output tool card (`$ command` + exit badge) |
| `blue-pane-activity` | activity pane (waiting/running/composing indicator) |
| `blue-pane-queue` | queued-messages pane + empty-editor Up recall |
| `blue-pane-todo` | todo pane (Ctrl-T collapse toggle) |
| `blue-pane-btw` | `/btw` side-question pane |
| `blue-pane-agents` | subagent-group pane (running subagents' group card, last dock row) |

### Assembly segment (3 rows) — the closing rows

| Row | Responsibility |
| --- | --- |
| `blue-interaction` | input editor, built-in commands, questionnaire provider, approval answerer |
| `blue-startup` | startup values provider (task positional, `--resume`) |
| `blue-app` | Agent driver: creates/resumes the session and publishes `blueSession` |

## plain-first

Baseline + assembly (8 rows total) is the complete, self-sufficient Blue UI. Blue's own enhancements register through the same seams downstream plugins use — drop the whole enhancement segment and the bundle still boots and works. Every enhancement row is thereby held to the test of "is the world better with it", and downstream plugins get mechanism-level parity with built-ins.

## Bottom dock order

Bottom-pinned components (footer, panes, editor) render in mount order. Assembly pins the dock order through the `blueComponents` activation round: **activity → queue → todo → btw → agents, editor last** (the editor always sits directly above the bottom row, panes stacked above it).

## Where to read more

- [Streaming transcript & tool cards](/en/features/streaming)
- [Input editor](/en/features/editor)
- [Approvals & questionnaires](/en/features/approval)
- [Status bar](/en/features/status-bar)
- [Session modes](/en/features/modes) — normal / plan / yolo and plan review
- [Bottom panes](/en/features/panes)
