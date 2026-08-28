# Built-in tools

The catalog of dsh's built-in tools, grouped by purpose. Which tools actually appear in your session depends on the profile composition and the [agent preset](/en/dsh/modes) (Minimal has two tools; under PTC mode most tools fold into `run_code`); experimental tools are off by default.

## Interaction & planning

| Tool | Description |
| --- | --- |
| `ask_user_question` | pauses the tool call to ask the user for confirmation or multiple-choice answers |
| `exit_plan_mode` | submits a Markdown plan for review and exits plan mode on approval |
| `skill` | loads the full instructions of a named skill |

## Shell

| Tool | Description |
| --- | --- |
| `bash` | one-shot bash command (`bash -c`, no state between calls); a persistent variant keeps cwd/env |
| `pwsh` | the Windows PowerShell equivalent (one-shot and persistent) |

## Filesystem

| Tool | Description |
| --- | --- |
| `str_replace_editor` | view/create/edit files (view / create / str_replace / insert) |
| `edit` · `write` · `read` · `read_image` | literal-replacement edit, whole-file write, line-numbered read, image read (vision-capable model required) |
| `glob` · `grep` | glob file search (max 100), ripgrep content search (up to 250 line-numbered matches) |

## Terminal

| Tool | Description |
| --- | --- |
| `terminal_open` / `terminal_list` / `terminal_close` | create, list, and close persistent terminal sessions |
| `terminal_read` / `terminal_send` / `terminal_signal` | read retained output, send text, signal the foreground process group |

## Subagents & orchestration

| Tool | Description |
| --- | --- |
| `subagent` / `subagent_fork` | delegate a self-contained task to an independent subagent; the fork variant is one-shot, foreground by default |
| `send_message` / `interrupt_agent` / `list_agents` | follow up a running background subagent, request cancellation, list status |
| `job_output` / `job_list` / `job_kill` | read, list, and stop background jobs of any kind |
| `ralph` · `workflow` | a fixed-loop fresh-agent workflow; a plain-JS orchestration script (agent/pipeline/parallel hooks) |
| Team tools (experimental, off by default) | the `spawn_teammate`, `team_task_*` multi-agent collaboration set |

## Navigation & knowledge

| Tool | Description |
| --- | --- |
| `lsp` | LSP queries: definition, references, implementation, hover |
| `session_event_read` / `session_event_search` / `session_event_trace` | read/search/trace events in an authorized session |
| `session_search` / `session_trace` | search prior sessions and read session lineage |

## Goals, scheduling & web

| Tool | Description |
| --- | --- |
| `create_goal` / `get_goal` / `update_goal` | manage a persistent same-session goal |
| `schedule_create` / `schedule_list` / `schedule_delete` | session-local reminders (one-shot or fixed-rate) |
| `todo_write` | replace the full structured task list (rendered by Blue's [todo pane](/en/features/panes)) |
| `web_fetch` · `web_search` | fetch and decode a URL to text; web search over 1–4 merged queries |

## PTC mode & dynamic plugins (opt-in)

| Tool | Description |
| --- | --- |
| `run_code` | execute a TypeScript program (async function body) calling other tools through bindings — the reserved transport under `tools.mode: ptc/both` |
| `cordis_*` (opt-in) | `cordis_define` / `cordis_inspect_*` / `cordis_run` / `cordis_stop` / `cordis_undefine`: define, inspect, activate, and remove dynamic Cordis plugins at runtime |

::: tip Full schemas
Every tool's parameter schema is maintained in the official generated [tool catalog](https://deepseek-harness.github.io/deepseek-harness/reference/tool-catalog) — this page is the purpose cheat sheet; field details live there. How tool calls render in a Blue session is covered in [Streaming transcript & tool cards](/en/features/streaming).

**Note**: the terminal and lsp groups are not assembled by default — install the [official optional plugins](/en/dsh/plugins) (persistent terminal, LSP navigation).
:::
