# Bottom panes

Between the status bar and the input editor sits the **bottom dock**: four passive panes stacked in mount order (activity → queue → todo → btw, editor last). Panes with nothing to say render zero rows — the dock never jumps.

## Activity pane

A mode machine over the attached session's event stream, telling you what the agent is doing:

| Mode | Presentation |
| --- | --- |
| waiting / tool | moon spinner + rotating tip (a new tip when the loading kind changes) |
| composing | braille `working...` line (primary-colored frames + an inline tip) — no output cursor; this line is the "writing" signal |
| thinking | cleared (the spinner belongs to the transcript's thinking block) |
| idle | a one-row placeholder (stable dock edge) |
| dialog open | the row hides (a panel holds the editor slot) |

## Queue pane

Follow-ups you submit while the agent runs queue in the harness inbox — the pane lists them: one row per message with a `queued ↑ turn:|step:` prefix. Empty queue, zero rows.

**Up recall**: with an empty editor buffer, pressing ↑ removes the most recent queued message and puts its text back into your draft (steer intent wins over next-turn). Without the queue pane, ↑ goes to editor history.

## Todo pane

The session's todo list (whole-list snapshots, last-write-wins) renders under a kimi-style flat-rule frame: a `Todo` title + three-state dots — `✓` completed (muted, struck through), `●` in progress (primary, bold), `○` pending.

- **Five-row folding** — long lists fold to all in-progress first, then the earliest pending and the latest completed; a one-row footer `… +N more (2 done · 1 pending) · ctrl+t to expand` accounts for the hidden items.
- **Ctrl-T** toggles between folded and full (`all N items · ctrl+t to collapse`); the expanded state survives writes and resets on session change or a settled list.
- **All-completed auto-close** — the next write reopens folded.

`todo_write` calls never appear in the transcript; this pane is the list's only surface.

## Side-question pane (/btw)

`/btw <question>` forks the current session into a throwaway side agent — seeded with the full event stream, inheriting the parent's provider/model — to ask an "by the way" question without disturbing the main line:

- pane title ` BTW ` + key hints (`Esc close`, plus `↑↓ scroll` when the body overflows);
- a `› question` row + streaming Markdown reply + a thinking line; the line budget adapts to terminal height (re-flowing on resize);
- while open, the editor's top corner joins the pane with `├┤`; **Esc** closes (draft survives), **↑↓** scroll, **Enter** asks a follow-up on the same side agent;
- one slot at a time: a new `/btw` disposes the previous side agent first; a bare `/btw` closes the pane.
