# Slash commands reference

Typing `/` triggers fuzzy autocomplete and discovery hints (see [Input editor](/en/features/editor)); the `/help` overlay lists registered commands live — if anything differs, trust `/help`.

## Built-in commands

| Command | Aliases | Arguments | Description | Source |
| --- | --- | --- | --- | --- |
| `/quit` | `/q` `/exit` | — | Exit Blue | `blue-commands` |
| `/new` | `/clear` | — | Start a new session | `blue-commands` |
| `/fork` | — | — | Fork the current session into a new one | `blue-commands` |
| `/sessions` | `/resume` | `<session-id>` | List persisted sessions and switch (title rows + type-to-filter); an id resumes directly | `blue-commands` |
| `/btw` | — | `<question>` | Side question: fork the live session and ask | `blue-pane-btw` |
| `/help` | — | — | Show available commands and key bindings | `blue-commands` |
| `/model` | — | `[id]` | Switch the session model (no argument opens the picker) | `blue-model-commands` |
| `/effort` | `/thinking` | `[level]` | Switch the thinking effort (no argument opens the selector) | `blue-model-commands` |
| `/provider` | — | `[list \| switch <name> \| add]` | List providers, switch the route, or add one | `blue-model-commands` |
| `/preset` | — | `[name]` | List agent presets or switch (blank sessions only) | `blue-preset-commands` |
| `/permission` | — | `[name]` | List permission presets or switch (input-layer interception; not in the `/help` registry) | `blue-interaction` (S24b) |
| `/yolo` | `/yes` | `[on\|off]` | Toggle auto-approval of tool calls (questions still pop) | `blue-mode-commands` |
| `/tools` | — | — | List the tools visible to the current session | `blue-tools-commands` |
| `/mcp` | — | — | Browse the MCP servers the host connects to and their tools | `blue-mcp-commands` (S34) |
| `/skills` | — | — | List available skills (the `#` prompt invokes one) | `blue-skills-command` |
| `/theme` | see [Theming](/en/guide/theme) | | List or switch themes | `blue-commands` (via theme-switch) |
| `/init` | — | — | Analyze the codebase and write `AGENTS.md` | `blue-session-init` |
| `/status` | — | — | Show the session header, model, and context status | `blue-commands` |
| `/context` | — | — | Show token usage and the context window | `blue-usage` |
| `/version` | — | — | Show the Blue and harness versions and the live model | `blue-commands` |
| `/changelog` | — | — | Show the release changelog (what's new, one section per release, the running version badged `· current`) | `blue-commands` |
| `/trace` | — | `[copy <seq> \| copy all]` | Inspect the current session's execution timeline; copy one item or the full trace | `blue-commands` |
| `/update` | — | `[version]` | Safely update Blue (pre-flight, snapshot, boot smoke, automatic rollback; a bare call is a read-only check) | `blue-commands` (via update-command, D52) |
| `/export` | — | `[path]` | Export the current session as a Markdown file | `blue-session-export` |
| `/copy` | — | — | Copy the last assistant message to the clipboard | `blue-session-export` |

## Sessions and models

- **`/resume <session-id>`** — without an argument it returns `usage: /resume <session-id>`. `/sessions` offers a picker instead (newest first, the current session badged `← current`; the list is scoped to the current working directory, rows show session titles, and **typing filters live** — `Esc` clears the filter first, a second press cancels).
- **`/fork`** — returns `cannot fork while the agent is running` while the agent is not idle.
- **`/model` / `/effort`** — no argument opens the model picker (with the footer's thinking-effort segment control) and the horizontal effort selector respectively; inside a panel `←` `→` step the segments and **`Alt+S` confirms session-only** — the next step's route switches immediately without persisting a new default. With an argument they switch directly and persist. The panel-free shortcut: **`Alt+M`** cycles through the current provider's models (session-only, draft preserved; see the [key reference](/en/reference/keys)).
- **`/provider`** — three subcommands: `list` shows providers and the current route; `switch <name>` switches; `add` starts the add-provider flow.
- **`/preset`** — switches the agent composition over the thin-host preset roster (`standard` / `code` / `minimal` / `cordis`): a session's tool surface, persona, and plan mode come from its preset. Switching is allowed only on **blank sessions** — a started one returns `cannot switch presets: this session has already started (blank sessions only)`.

## Modes and approval

- **`/yolo [on|off]`** — toggles yolo session mode; `Shift+Tab` cycles normal → plan → yolo at any time (see [Session modes](/en/features/modes)). Under yolo, tool calls are auto-approved while **user questions still pop**.
- **`/permission`** — lists/switches permission presets (named bundles of sandbox mode + approval policy). Same single-select panel shape as `/preset`; a danger preset requires a typed `y`. The command opens via input-layer interception (the host's own command ships unimplemented), so it is not in the `/help` registry.
- **`/mcp`** — a three-level panel browsing the MCP servers the host connects to: server picker → server panel (a config pseudo-row + raw tool rows) → detail (config status / redacted connection / policy, or a tool's schema). Read-only — servers are added via profile patch (see [dsh/mcp](/en/dsh/mcp)); the empty state points the way.
- **`/init`** — the agent analyzes the codebase and writes `AGENTS.md` in the project root: if one exists it is read first, still-accurate content carries forward, and the file is rewritten into one coherent, up-to-date document (not appended), in the language the project's own docs mainly use.

## Info and export

- **`/export [path]`** — exports the current session as Markdown; without a path it writes the default filename `blue-export-{id8}-{YYYYMMDD-HHMMSS}.md`.
- **`/copy`** — the last assistant message's text goes to the clipboard: OSC 52 first (the escape sequence travels over stdout to the local terminal emulator, so **SSH sessions still reach the local clipboard**), with a fallback pipeline behind it.
- **`/trace`** — reads the current execution timeline through the harness's official session query; Up/Down selects an item, Enter opens full JSON, PageUp/PageDown scrolls details, `c` copies one item, and `a` copies the complete trace.
- **`/theme`** — full usage `usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]`, see [Theming](/en/guide/theme).
- **`/quit`** — before the agent attaches it shows `no active session` (see the [FAQ](/en/guide/faq)).

Commands never enter a model turn — success/error text flashes on the editor hint line. Commands registered by downstream plugins through `ctx.commands` appear automatically in the completion menu and `/help`; aliases are not registered as commands — the input layer rewrites them to the canonical name before dispatch (the kimi `aliases` port); **input-layer intercepted commands** like `/permission` are likewise outside the registry — present in the completion menu, absent from `/help`.

## Parked commands

These commands exist in the reference products (kimi/Claude Code); Blue **deliberately parks** them — waiting on upstream primitives or real demand (the full rulings live in the repository roadmap's parked ledger):

- `/settings` `/reload` `/tasks` — deferred (configuration and task management go through profile/config files)
- `/archive` `/delete` — upstream persistence has no delete/archive primitive yet
- `/import` — session-format version strictness undecided
- `/diff` (uncommitted-changes panel) and the full-screen approval diff preview — re-evaluated with dogfood feedback after release
- `/debug` — needs an upstream diagnostics-export surface
