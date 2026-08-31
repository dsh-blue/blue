# Key bindings

Keys register through the `blueKeymap` service; duplicate bindings are rejected. The `/help` overlay lists every registered binding live — it is the authoritative source for this table (if anything differs, trust `/help`).

## Global actions

In effect regardless of focus:

| Key | Action | Description |
| --- | --- | --- |
| `Ctrl-O` | Toggle tool output expansion | Switch the most recent **3 turns** of tool cards and thinking blocks between one-line summary and full output |
| `Ctrl-T` | Toggle todo pane folding | Five-row folded view ↔ full list |

## Shared interaction keys

A focused surface uses two navigation levels: Tab/Shift-Tab switches semantic
control groups, while arrows move only inside the active group. The contextual
hint at the bottom appears only while that surface owns focus and changes with
editing, adjustment, and confirmation state:

| Key | Action | Description |
| --- | --- | --- |
| `Tab` / `Shift-Tab` | Switch control groups | For example tabs → form → actions; returning restores that group's last focus |
| `←` / `→` | Navigate a horizontal group | Tabs, actions, and a select's adjustment state |
| `Enter` | Submit / confirm | Submit input or confirm the focused choice |
| `Escape` | Cancel / retract / dismiss | Close the active surface (completion popup → side pane → clear draft, yielding step by step); while the agent runs, retract a tool-free current message back into the editor, otherwise interrupt normally |
| `↑` / `↓` | Navigate a vertical group | Lists and forms in navigation state (wraps) |
| `Space` | Toggle selection | Toggle the focused entry in a multi-select |

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
| `/sessions` picker | ↑↓ navigate, `Enter` resume, `Esc` cancel |
| Approval panel | ↑↓ + `Enter`, or number keys `1`–`4` directly; `Escape` rejects |
| Questionnaire | `Tab` / `Shift-Tab` between questions; single-choice ↑↓ + `Enter`; multi-choice `Space` + `Enter`; `Esc` inside the Other editor returns to the list |
| Form panel | `Up` / `Down` changes fields in navigation; first `Enter` enters text editing and the next confirms, with `Alt+Enter` inserting a textarea newline; a select uses `Enter` to enter, `←` / `→` to adjust, and `Enter` to confirm; `Tab` switches semantic groups; `Escape` first leaves or cancels control editing, then cancels the surface |
| Plan review | `←` / `→` or `1`–`3` choose a decision; `↑` / `↓` / `PageUp` / `PageDown` scroll the plan; `Enter` confirms |
| `/model` · `/effort` panels | `←` `→` step the segment control; `Enter` confirms and persists the new default; `Alt+S` confirms **session-only** (the persisted default stays untouched) |
| `/btw` pane | `Esc` close; mouse wheel / `PageUp` / `PageDown` scroll; `Enter` follow-up |

## Custom bindings

Deferred to a later phase. There is no user-facing key configuration today; conflicts are prevented by rejecting duplicate registrations at keymap registration time.
