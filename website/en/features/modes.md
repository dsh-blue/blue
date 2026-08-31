# Session modes

Blue's interaction intensity has three session modes, cycled with **`Shift+Tab`** under editor focus:

**normal → plan → yolo**

Outside normal, a mode badge sits in the status bar's first row (`plan` in the accent tier, with a pending ellipsis while messages are queued; `yolo` in the warning tier). `/yolo [on|off]` (alias `/yes`) is the command form of the yolo toggle — same effect as cycling.

## normal

The default. Every tool call pops the four-option approval panel (allow once / allow for this session / reject / reject with feedback, see [Approvals & questionnaires](/en/features/approval)); user questions pop as usual.

## plan — plan first, act later

In plan mode the agent produces a plan before acting. When the plan is final, the harness's `exit_plan_mode` request surfaces as the **plan review panel** (editor-slot replacement, mounted like the approval panel):

- the full plan renders as Markdown inside a bordered `plan` box;
- beneath it a numbered decision list — number keys pick directly, or ←→ +
  `Enter`; ↑↓ / PageUp / PageDown scroll only the plan body:

| Option | Effect |
| --- | --- |
| `1. Approve` | Approve the plan, exit plan mode, start executing |
| `2. Reject` | Reject — the model hears "the user chose to keep planning" and reacts in the same turn |
| `3. Revise <text>` | Inline revision: keep polishing the plan with your feedback |

## yolo — auto-approve

yolo auto-approves tool calls — the four-option panel stops popping and the agent runs at full speed. **User questions still pop**: yolo waives tool authorization, it does not answer questions for you. `/yolo`, `/yes`, or another `Shift+Tab` cycles back at any time.

::: tip Relation to /preset
Plan mode is supplied by the harness's plan-mode plugin, composed through agent presets (`/preset`, see the [slash commands reference](/en/reference/commands)) — the preset decides which capabilities a session has; the session mode decides how closely this interaction asks.
:::
