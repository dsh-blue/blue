# Key bindings

Keys register through the `blueKeymap` service; duplicate bindings are rejected. The `/help` overlay lists every registered binding live — it is the authoritative source for this table (if anything differs, trust `/help`).

## Global actions

In effect regardless of focus:

| Key | Action | Description |
| --- | --- | --- |
| `Ctrl-O` | Toggle tool output expansion | Switch the most recent **3 turns** of tool cards and thinking blocks between one-line summary and full output |
| `Ctrl-T` | Toggle todo pane folding | Five-row folded view ↔ full list |
| `F6` / `Shift+F6` | Move surface focus | Traverse the Editor and pane lanes in layout order; crossing an end returns to the Editor, while an open capturing overlay owns focus |

## Shared interaction keys

A focused surface uses a hierarchy: outer tabs → nested tabs → content groups
→ editing. The contextual hint at the bottom appears only while that surface
owns focus and changes with the active layer, editing, adjustment, and
confirmation state:

| Key | Action | Description |
| --- | --- | --- |
| `←` / `→` | Navigate a horizontal layer | Move inside tabs, actions, and select adjustment without wrapping |
| `Enter` | Descend / submit / confirm | Descend from a tab strip or activate a list, action, or input confirmation |
| `Tab` / `Shift-Tab` | Switch content groups | Cycle list/form/action semantic groups and remember in-group focus; inert on tab strips |
| `Escape` | Return / cancel / dismiss | Editing → content → nested tabs → outer tabs → close, one layer per press; once back in the Editor, the completion/retract/interrupt chain applies |
| `↑` / `↓` | Navigate a vertical layer | Move inside lists and forms without wrapping; disabled rows are skipped |
| `Space` | Toggle selection | Toggle the focused multi-select entry; `Enter` confirms the set |

## Editor context

Text-editing keys (cursor movement, multi-line, undo, kill-ring) belong to the underlying editor; in addition:

| Key | Action | Description |
| --- | --- | --- |
| `Ctrl-C` | Clear → interrupt → exit | Clears the draft, then interrupts a running agent; a **second press within 1 second** exits Blue |
| `Ctrl-S` | Steer | Inject the non-empty draft as a steering instruction into the current turn, clearing the buffer |
| `Ctrl-V` | Paste image | Store the clipboard image in the attachment library, inserting an `[image #N]` marker at the cursor |
| `Ctrl-G` | External editor | Hand the draft to an external editor for full-screen editing (`blue.editorCommand` setting → `$VISUAL` → `$EDITOR`; Blue suspends and yields the terminal); quitting with `:cq` leaves the draft untouched |
| `Alt+M` | Cycle session model | Step through the current provider's models (**session-only**, no persisted default; the press is consumed, the draft stays intact) |
| `Backspace` | Delete / exit mode | Backspace on an empty `!` bash prompt exits back to prompt mode |
| `Shift+Tab` | Cycle session mode | normal → plan → yolo (see [Session modes](/en/features/modes)). Effective only under editor focus — panels and questionnaires keep their own Tab navigation |

## Panel contexts

| Surface | Keys |
| --- | --- |
| `/help` overlay | ↑↓ / PageUp / PageDown scroll; `Escape` / `Enter` / `q` close |
| `/sessions` picker | ↑↓ navigates without wrapping and `Enter` resumes; after typing a filter, `Esc` only ends filtering and preserves the query, while the focused `Clear filter` action clears it before layered exit |
| Approval panel | non-wrapping ↑↓ + `Enter`, or number keys `1`–`4` directly; `Escape` rejects |
| Questionnaire | question tabs use non-wrapping `←` / `→`, then `Enter` enters content; Tab is inert on the question tabs; single-choice uses ↑↓ + `Enter`, multi-choice uses `Space` + `Enter`, and `Esc` inside Other returns to the list |
| Form panel | non-wrapping `Up` / `Down` changes fields in navigation; first `Enter` enters text editing, then `Enter` or a valid `Tab` confirms, while invalid input stays on the field; `Alt+Enter` inserts a textarea newline; a select uses `Enter` to enter, `←` / `→` to adjust, and `Enter`/valid `Tab` to confirm; content-level Tab switches semantic groups and `Escape` climbs layers |
| Plan review | `←` / `→` or `1`–`3` choose a decision; `↑` / `↓` / `PageUp` / `PageDown` scroll the plan; `Enter` confirms |
| `/model` panel | providers are the only tab layer: non-wrapping `←` / `→` switches provider and `Enter` enters the model list; in the list, `↑` / `↓` selects a model, `←` / `→` adjusts that model's thinking level, and `Tab` reaches the equal action choices |
| `/effort` panel | non-wrapping `←` / `→` moves between thinking levels and `Enter` descends; `Set as default` persists while `Use for this session` changes only the live session |
| `/btw` pane | `Esc` close; mouse wheel / `PageUp` / `PageDown` scroll; `Enter` follow-up |

## Custom bindings

Deferred to a later phase. There is no user-facing key configuration today; conflicts are prevented by rejecting duplicate registrations at keymap registration time.
