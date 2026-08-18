# `@deepseek-ai/dsh-blue`

English | [中文](README.zh.md)

The dsh Blue bundle: the interactive terminal UI profile. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md); selected via `dsh --profile blue` (template `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-blue']`). The patch overrides the `system-prompt` persona, keeps the shared HMR row off, and inserts ten Blue rows in two segments. The plain baseline segment: `blue-core` (the tree's only pi-tui adapter: terminal lifecycle plus the `blueScreen`/`blueKeymap`/`blueTerminalInfo`/`blueComponents` services), `blue-theme-dark` (the `blueTheme` provider — the built-in dark palette), `blue-transcript` (session-event rendering, the `blueStatus` registry, and the footer shell), `blue-status-basic` (the baseline `{model} · {status}` footer entry), `blue-interaction` (input editor, `/quit` `/resume` `/theme`, user questions, approvals), `blue-startup` (`@deepseek-ai/dsh-blue-app/startup`, parses `[task]` and `--resume <id>`), and `blue-app` (the Agent driver, reading its launch values through lazy `!!js ctx.blueStartup.*` config interpolation). The enhancement segment: `blue-editor-plus` (`!` bash mode with shell echo, slash/`@` autocomplete over the shared editor), `blue-status-git` (git-branch footer entry), and `blue-status-context` (context-occupancy footer entry).

## Model Experience

Indirectly, through the inserted rows: this bundle is a patch-list carrier and contributes no model-visible text of its own beyond the persona override quoted in the patch.

#### KV Cache effect

The persona override is a static prefix; each inserted row's package owns its own prefix effect.

## Known Limitations and Deferred Work

- **No bundle-level limitations known** — the composed profile is exercised end to end by the whole-tree e2e (`tests/e2e.spec.ts`, 15 cases: boot, task runs, typed input, approval overlay, editor key semantics, resume, `/theme` palette swap with draft preservation and transcript re-render, teardown) with a scripted mock LLM adapter and core's recording FakeTerminal; only the model and the process terminal are substituted.
