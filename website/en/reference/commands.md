# Slash commands reference

Typing `/` triggers fuzzy autocomplete and discovery hints (see [Input editor](/en/features/editor)); the `/help` overlay lists registered commands live — if anything differs, trust `/help`.

## Built-in commands

| Command | Aliases | Arguments | Description | Source |
| --- | --- | --- | --- | --- |
| `/quit` | `/q` `/exit` | — | Exit Blue | `blue-commands` |
| `/new` | `/clear` | — | Start a new session | `blue-commands` |
| `/fork` | — | — | Fork the current session into a new one | `blue-commands` |
| `/sessions` | `/resume` | `<session-id>` | List persisted sessions and switch; an id resumes directly | `blue-commands` |
| `/btw` | — | `<question>` | Side question: fork the live session and ask | `blue-pane-btw` |
| `/help` | — | — | Show available commands and key bindings | `blue-commands` |
| `/model` | — | `[id]` | Switch the session model (no argument opens the picker) | `blue-model-commands` |
| `/effort` | `/thinking` | `[level]` | Switch the thinking effort (no argument opens the selector) | `blue-model-commands` |
| `/provider` | — | `[list \| switch <name> \| add]` | List providers, switch the route, or add one | `blue-model-commands` |
| `/preset` | — | `[name]` | List agent presets or switch (blank sessions only) | `blue-preset-commands` |
| `/yolo` | `/yes` | `[on\|off]` | Toggle auto-approval of tool calls (questions still pop) | `blue-mode-commands` |
| `/tools` | — | — | List the tools visible to the current session | `blue-tools-commands` |
| `/skills` | — | — | List available skills (the `#` prompt invokes one) | `blue-skills-command` |
| `/theme` | see [Theming](/en/guide/theme) | | List or switch themes | `blue-commands` (via theme-switch) |
| `/update` | — | `[version]` | Safely upgrade Blue with preflight, smoke checks, and rollback | `blue-commands` (via update-command, D52) |
| `/settings` | — | — | Open the settings panel and edit settings.yaml | `blue-commands` (via settings-command) |
| `/init` | — | — | Analyze the codebase and write `AGENTS.md` | `blue-session-init` |
| `/status` | — | — | Show the session header, model, and context status | `blue-commands` |
| `/context` | — | — | Show token usage and the context window | `blue-usage` |
| `/version` | — | — | Show the Blue and harness versions and the live model | `blue-commands` |
| `/export` | — | `[path]` | Export the current session as a Markdown file | `blue-session-export` |
| `/copy` | — | — | Copy the last assistant message to the clipboard | `blue-session-export` |

## Sessions and models

- **`/resume <session-id>`** — without an argument it returns `usage: /resume <session-id>`. `/sessions` offers a picker instead (newest first, the current session badged `← current`).
- **`/fork`** — returns `cannot fork while the agent is running` while the agent is not idle.
- **`/model` / `/effort`** — no argument opens the model picker (with the footer's thinking-effort segment control) and the horizontal effort selector respectively; inside a panel `←` `→` step the segments and **`Alt+S` confirms session-only** — the next step's route switches immediately without persisting a new default. With an argument they switch directly and persist.
- **`/provider`** — three subcommands: `list` shows providers and the current route; `switch <name>` switches; `add` starts the add-provider flow.
- **`/preset`** — switches the agent composition over the thin-host preset roster (`standard` / `code` / `minimal` / `cordis`): a session's tool surface, persona, and plan mode come from its preset. Switching is allowed only on **blank sessions** — a started one returns `cannot switch presets: this session has already started (blank sessions only)`.

## Modes and approval

- **`/yolo [on|off]`** — toggles yolo session mode; `Shift+Tab` cycles normal → plan → yolo at any time (see [Session modes](/en/features/modes)). Under yolo, tool calls are auto-approved while **user questions still pop**.
- **`/init`** — the agent analyzes the codebase and writes `AGENTS.md` in the project root: if one exists it is read first, still-accurate content carries forward, and the file is rewritten into one coherent, up-to-date document (not appended), in the language the project's own docs mainly use.

## Info and export

- **`/export [path]`** — exports the current session as Markdown; without a path it writes the default filename `blue-export-{id8}-{YYYYMMDD-HHMMSS}.md`.
- **`/copy`** — the last assistant message's text goes to the clipboard: OSC 52 first (the escape sequence travels over stdout to the local terminal emulator, so **SSH sessions still reach the local clipboard**), with a fallback pipeline behind it.
- **`/theme`** — full usage `usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]`, see [Theming](/en/guide/theme).
- **`/settings`** — open the two-level settings panel: level one groups rows by namespace (namespaces the host never registered are omitted), Enter steps into level two; there `↑↓` selects a row, `Enter`/`Space` steps the preset value, every change writes straight to settings.yaml (the default theme applies live and persists as the startup default; `permission.defaultPreset` affects new sessions only), and Escape pops back to level one. Level one's last row `Open settings.yaml in $EDITOR` opens the whole document in `$VISUAL`/`$EDITOR`, and external edits flow back into the panel live. The persisted `blue:` section is documented in [Configuration](/en/guide/config).
- **`/quit`** — before the agent attaches it shows `no active session` (see the [FAQ](/en/guide/faq)).

Commands never enter a model turn — success/error text flashes on the editor hint line. Commands registered by downstream plugins through `ctx.commands` appear automatically in the completion menu and `/help`; aliases are not registered as commands — the input layer rewrites them to the canonical name before dispatch (the kimi `aliases` port).
