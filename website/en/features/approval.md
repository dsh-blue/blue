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

`ctx.userQuestions` requests (clarifying questions and the like) open a tabbed questionnaire, one tab per question:

- the tab row shows each question's header (or `Q{i+1}`); the active tab is highlighted, answered tabs `(✓)`, unanswered `(○)`;
- **Tab / Shift-Tab** move between questions; single-choice via ↑↓ + Enter, multi-choice via Space + Enter;
- every question ends with a fixed **Other** pseudo-entry opening an inline editor; the free text becomes the answer;
- questions without options go straight to the editor;
- answering everything resolves automatically; Escape rejects the request, an aborted signal closes and rejects it too.

Questionnaire answers enter the session as user-visible content the model can see.
