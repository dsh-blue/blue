# Streaming transcript & tool cards

The transcript layer folds the session event stream into items and renders them. This page describes what you see; the event-to-item rules are identical for live streams and snapshot replay.

## Message items

- **User messages** — `❯` gutter bubbles (`roleUser` color); images render inline where the terminal supports it (12-line cap), otherwise as `[image]` placeholders.
- **Assistant messages** — rendered as Markdown while streaming (headings, links, inline code, code blocks, quotes, and lists each have dedicated tokens), separated by blank lines, first line bulleted `●`, continuation indented two columns.
- **Thinking blocks** — reasoning streams as its own block above the body: a braille spinner + `thinking...` label with a rolling tail window while live; after close, folded to a two-line italic preview with `... (N more lines, ctrl+o to expand)`.

## Tool cards

Tool calls render as the **generic card** by default: a status dot — `○` running (`primary`) or `●` settled (success/error colored) — plus an indented `⎿` one-line summary; Ctrl-O toggles between summary and full output.

Two **dedicated cards** register through render intents and take over when a tool's presentation view declares `diff` or `terminal`:

- **Diff card** — per-file unified diff with LCS line coloring (added/removed/strong/gutter tokens); 12 lines per file collapsed, 200 expanded.
- **Terminal card** — `$ command` header (shellMode color) + cwd + exit badge (error/warning colored); output rows 10 collapsed, 120 expanded; a finished run with no output shows `(no output)`.

Unknown tools, or tools without presenters, always fall back to the generic card — intent resolution never throws.

## Step folding and the long-session window

- **step-summary** — within a turn, when the next step starts, the previous step's tool items fold into a single `… step N · Tool ×M` line; the turn's last step stays expanded (a visible tail of tool cards per turn).
- **Ctrl-O scope** — applies to the most recent **3 turns** of tool cards and thinking blocks.
- **Sliding window** — only the latest 15 completed turns stay mounted; older turns are silently evicted from the render tree (event data stays complete in the session record). A 200-turn session keeps ~90 mounted components — scrolling stays smooth.

## Special cases

- `todo_write` calls and results **never appear in the transcript** — the todo pane is their only surface (see [Bottom panes](/en/features/panes)).
- Synthetic injected messages (workspace instructions, context snapshots) **render as nothing** — the content still reaches the model, the stream stays clean (see the [FAQ](/en/guide/faq)).
