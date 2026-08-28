# Official optional plugins

The `dsh-base` default assembly (78 plugin rows) already covers the full capability set: all built-in tools (shell/files/search/subagents/todo/goal/web/workflow), sandbox & approval, permission presets, plan mode, context compaction, the repeat-tool-call reminder, skills, session titles, and more. **But the following capabilities ship officially while staying out of the default assembly** — they are the everyday features of Codex / Claude Code-style TUIs and need an explicit `dsh plugin --profile <name> add`.

## The list

| Capability | Packages to install | What it provides | The TUI feature |
| --- | --- | --- | --- |
| **Persistent terminal (PTY)** | `@deepseek-ai/dsh-terminal-bash` + `@deepseek-ai/dsh-tool-terminal` | six tools: `terminal_open` / `send` / `read` / `signal` / `close` / `list` | the interactive terminal of Codex / Claude Code: persistent sessions keeping cwd/env, foreground process groups, signalling |
| **LSP navigation** | `@deepseek-ai/dsh-lsp-stdio` + `@deepseek-ai/dsh-tool-lsp` | one read-only `lsp` tool: goToDefinition / findReferences / goToImplementation / hover | precise code navigation — when textual matches are ambiguous or a change needs exact definitions |
| **PTC runtime** | `@deepseek-ai/dsh-code-runtime-worker-thread` (TypeScript) or `@deepseek-ai/dsh-code-runtime-python` | the execution environment behind `run_code` | a prerequisite of PTC mode: **no runtime by default**, `tools.mode: ptc/both` requires one |
| **MCP** | `@deepseek-ai/dsh-mcp-client` | `mcp__server__tool` external tools | the external-tool protocol, see [MCP setup](/en/dsh/mcp) |
| **ACP** | `@deepseek-ai/dsh-acp` | an Agent Client Protocol server (JSON-RPC stdio) | automation clients (CLIs) driving harness agents programmatically |

## Installing & assembling

Install first, then add the rows to the profile's patch file (`id` is yours to pick; `name` is the package):

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-terminal-bash @deepseek-ai/dsh-tool-terminal
```

```yaml
# Persistent terminal: backend + model tools, both rows required
- id: terminal-bash
  name: '@deepseek-ai/dsh-terminal-bash'
- id: tool-terminal
  name: '@deepseek-ai/dsh-tool-terminal'

# LSP: stdio provider + model tool
- id: lsp-stdio
  name: '@deepseek-ai/dsh-lsp-stdio'
- id: tool-lsp
  name: '@deepseek-ai/dsh-tool-lsp'

# PTC runtime (TypeScript): one row, a code-execution environment
- id: code-runtime
  name: '@deepseek-ai/dsh-code-runtime-worker-thread'
  config:
    computeMs: 60000              # busy-time budget (measured event-loop activity)
    maxWallMs: 600000             # wall-clock ceiling
    maxOutputBytes: 67108864      # combined output cap (64 MiB)
    maxOldGenerationSizeMb: 512   # worker heap cap
```

Notes:

- **PTY composes with the sandbox**: `terminal-bash` injects `sandboxPolicy`; confined modes wrap the shell argv through `ctx.sandbox`, `danger-full-access` starts it directly. A session-mode downgrade is rejected while that owner holds an open PTY — close terminals before downgrading;
- **LSP needs a workspace**: the `lsp` tool requires the session `cwd` for its workspace root — absence fails as `LSP_WORKSPACE_REQUIRED`; timeout, location count, and result length are configurable (defaults 60s / 100 locations / 16KB);
- **The PTC runtime is containment, not a security boundary**: `worker-thread` runs each program in one fresh worker (empty environment, heap cap, hard termination) — trust posture is bash-equivalent by design;
- **tool-terminal details**: `run_in_background: true` reuses `ctx.jobs` (present by default); foreground sends render as terminal cards, background sends as generic execute cards; every operation requires the exact initiating agent, so a model cannot address another agent's terminal.

## Relation to Blue

- **terminal tools** → Blue renders the dedicated **terminal card** (`$ command` + exit badge + capped output, see [Streaming transcript & tool cards](/en/features/streaming));
- **lsp tool** → the generic tool card (no dedicated card yet);
- **PTC runtime**: PTC mode switches in Blue as usual, but the profile must mount a runtime before the model can actually use `run_code` — no code-runtime row in `--dump-config` means it isn't installed;
- every request pays the schema token cost of installed tools (see [System prompt](/en/dsh/system-prompt)).

::: tip Boundary note
This list focuses on everyday TUI capabilities and is not exhaustive. The full official package catalog is whatever `@deepseek-ai/dsh-*` exposes on the npm registry; most optional plugins run on independent `0.0.1-rc.x` version lines, out of sync with dsh's main line. Assembly-row shapes come from each package's README ([packages/mcp](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp), [packages/terminal](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/terminal), [packages/lsp](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/lsp), [packages/code-runtime](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/code-runtime)).
:::
