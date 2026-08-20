# Slash commands reference

Typing `/` triggers fuzzy autocomplete and discovery hints (see [Input editor](/en/features/editor)); the `/help` overlay lists registered commands live — if anything differs, trust `/help`.

## Built-in commands

| Command | Arguments | Description | Source plugin |
| --- | --- | --- | --- |
| `/quit` | — | Exit Blue | `blue-commands` |
| `/resume` | `<session-id>` | Resume a previous session | `blue-commands` |
| `/new` | — | Start a new session | `blue-commands` |
| `/fork` | — | Fork the current session into a new one | `blue-commands` |
| `/sessions` | — | List persisted sessions and switch to one | `blue-commands` |
| `/help` | — | Show available commands and key bindings | `blue-commands` |
| `/theme` | see [Theming](/en/guide/theme) | List or switch themes | `blue-commands` (via theme-switch) |
| `/btw` | `<question>` | Side question: fork the live session and ask | `blue-pane-btw` |

## Behavior notes

- **`/resume <session-id>`** — without an argument it returns `usage: /resume <session-id>`. `/sessions` offers a picker instead (newest first, the current session badged `← current`).
- **`/fork`** — returns `cannot fork while the agent is running` while the agent is not idle.
- **`/theme`** — full usage `usage: /theme [dark|light|auto|custom <path> [dark|light]]`, see [Theming](/en/guide/theme).
- **`/btw <question>`** — see [Bottom panes](/en/features/panes); a bare `/btw` closes the pane.
- **`/quit`** — before the agent attaches it shows `no active session` (see the [FAQ](/en/guide/faq)).

Commands never enter a model turn — success/error text flashes on the editor hint line. Commands registered by downstream plugins through `ctx.commands` appear automatically in the completion menu and `/help`.
