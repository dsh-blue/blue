# Bottom panes

Between the status bar and the input editor sits the **bottom dock**: five passive panes stacked in mount order (activity → queue → todo → btw → agents, editor last). Panes with nothing to say render zero rows — the dock never jumps.

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

- pane title ` BTW ` + key hints (`Esc close`, plus `PgUp/PgDn or wheel` when the body overflows);
- a `› question` row + streaming Markdown reply + a thinking line; the line budget adapts to terminal height (re-flowing on resize);
- while open, the editor's top corner joins the pane with `├┤`; **Esc** closes (draft survives), mouse wheel / **PageUp** / **PageDown** scroll, and **Enter** asks a follow-up on the same side agent;
- one slot at a time: a new `/btw` disposes the previous side agent first; a bare `/btw` closes the pane.

## Subagent-group pane (agents)

While the agent's **subagent group** runs, its group card is pinned directly above the editor — the last dock row (the kimi swarm-pane semantics). Like the todo pane's relationship to `todo_write`: spawn-class tool calls are suppressed from the session stream by the step fold, and this pane is the only surface where running subagents appear — you can see who was spawned and what each is doing without digging through tool cards in the transcript.
