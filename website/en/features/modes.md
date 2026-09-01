# Session modes

Blue's interaction intensity has three session modes, cycled with **`Shift+Tab`** under editor focus:

**normal → plan → yolo**

Outside normal, a mode badge sits in the status bar's first row (`plan` in the accent tier, with a pending ellipsis while messages are queued; `yolo` in the warning tier). These are not Blue-owned states: plan comes from dsh's native `plan` projection, while yolo is the display label for the native `danger-full-access` + `never` permission preset.

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

## yolo — full access

yolo selects dsh's `danger-full-access` permission preset directly: the filesystem sandbox is disabled and the `never` approval policy applies, so the four-option approval panel stops popping. **User questions still pop** because a permission policy does not answer questions for you. Pressing `Shift+Tab` again selects `workspace-write`; the command forms are `/permission danger-full-access` and `/permission workspace-write`. Blue does not register extra `/yolo` or `/yes` commands.

Shift+Tab only orchestrates native commands: normal executes `/plan`; plan executes `/plan off` and then selects the full-access permission preset; yolo selects the workspace-write preset. If other commands leave plan and yolo active together, the cycle also exits plan to keep the three labels exclusive.

::: tip Relation to /preset
Plan mode is supplied by the harness's plan-mode plugin, composed through agent presets (`/preset`, see the [slash commands reference](/en/reference/commands)) — the preset decides which capabilities a session has; the session mode decides how closely this interaction asks.
:::
