# Approvals & questionnaires

When the agent needs a human decision, Blue answers with full-width pull-up panels. Panels mount by **editor-slot replacement**: the panel genuinely takes over the editor's dock slot — the editor leaves the tree (state intact), and only the two-row footer remains below the panel. The editor frame never peeks out from behind. Closing the panel restores the editor with focus and draft intact.

## Approval panel

When a tool call needs authorization, a four-choice panel opens: an amber rule + `▶ Approve {tool}?` title + numbered choices:

```
1. Allow once
2. Allow {tool} for this session
3. Reject
4. Reject with feedback
```

(Number keys select directly; ↑↓ + Enter navigate with wrap; the selected row carries a `▶` pointer.)

- **Session-level remember** — choice 2 records the tool in a session allowance table; later requests for the same agent + tool skip the panel entirely and pass through.
- **Reject with feedback** — choice 4 swaps the menu for an inline reason editor; submitting steers the agent with a user message (`User rejected …: <reason>`), so the agent sees why. An empty reason is a plain Reject (no steering).
- **Escape rejects**; an aborted request signal settles as cancelled.
- **FIFO serialization** — concurrent approval requests queue; one panel shows at a time.

Requests from other agents (not the one mounted in the UI) don't open a panel — they pass down the waterfall to the next answerer.

## Questionnaire panel

`ctx.userQuestions` requests (clarifying questions and the like) open a per-question panel that focuses one question at a time:

- the panel title reads `Question {i} of {N}`; the first row carries the progress `{i}/{N}` followed by every question's header (or `Q{i+1}`) — `●` current, `✓` answered, `○` unanswered;
- **Tab / Shift-Tab** move between questions; unsubmitted editor text is kept as a per-question draft and restored on return; Enter records the answer and jumps to the next unanswered question;
- single-choice via ↑↓ + Enter, multi-choice via Space + Enter; the cursor row is highlighted full-width (the Other row included);
- every question ends with a fixed **Other** pseudo-entry that opens a compact single-line input — a highlighted `> Answer` row; multi-line text is flattened to one line;
- questions without options go straight to the same single-line input;
- the footer keys follow the state: editing shows `↵ save · tab next · esc back` (`esc cancel` on optionless questions); the option list adds `space toggle` only for multi-choice;
- answering everything resolves automatically. Escape rejects the whole request — though inside the Other editor, Escape first saves the draft and returns to the option list; an aborted signal closes and rejects it too.

Questionnaire answers enter the session as user-visible content the model can see.

## Multi-field forms

Custom provider onboarding and the typed `y` confirmation for the danger permission preset use a multi-field form panel:

- each field starts on one compact `label · hint: value` row; the selected row carries `→`, and wrapped values continue under that row;
- **Up / Down** moves between fields only in navigation and remains available for cursor movement while editing; typing starts editing, the first **Enter** on an untouched field enters edit mode, and Enter while editing advances or submits the last field; **Tab** is reserved for semantic control groups; **Escape** first returns to navigation, then cancels;
- a validation error renders directly below the failing field without closing the panel; any edit clears it;
- values truncate to the panel width, so long pasted keys never break the frame.

## Plan-review panel

When the agent calls `exit_plan_mode` to wrap up a plan, the review request opens in a dedicated question shape (the `plan-review` intent over `ctx.userQuestions`): a **framed, scrollable window with the full rendered plan** plus a numbered triple:

```
1. Approve
2. Reject
3. Revise (inline feedback editor)
```

- the **Revise** row carries the feedback input; submitting answers with a decline-with-feedback (the harness folds it into "their feedback: …"), so the agent iterates on the plan with the notes; an empty submission equals a plain Reject;
- Approve/Reject settle directly; an aborted signal closes the panel with the cancellation code (`ASK_CANCELLED`).

Plan mode itself enters/exits through the `Shift+Tab` three-state cycle (normal → plan → yolo, see [Session modes](/en/features/modes)); the footer's mode badge reflects it live.

## Permission-preset panel

`/permission` opens the permission-preset selector (the same single-select list shape as `/sessions` and `/preset`): one row per preset (a named bundle of sandbox mode + approval policy), the active one marked `← current`; Enter switches through the host's same write path, and a **danger-level preset requires a typed `y`** (no accidental switches). A bare invocation is intercepted by the input layer to open the panel; the command itself is registered by the upstream `dsh-permission-presets`, and argumented calls pass through.
