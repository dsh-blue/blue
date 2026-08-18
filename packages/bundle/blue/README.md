# `@deepseek-ai/dsh-blue`

English | [中文](README.zh.md)

The dsh Blue bundle: the interactive terminal UI profile. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md); selected via `dsh --profile blue` (template `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-blue']`). The patch overrides the `system-prompt` persona, keeps the shared HMR row off, and inserts fourteen Blue rows in three segments. The baseline segment: `blue-core` (the tree's only pi-tui adapter: terminal lifecycle plus the `blueScreen`/`blueKeymap`/`blueTerminalInfo`/`blueComponents` services), `blue-theme-dark` (the `blueTheme` provider — the built-in dark palette), `blue-transcript` (session-event rendering, the `blueStatus` registry, and the footer shell), and `blue-status-basic` (the baseline `{model} · {status}` footer entry). The enhancement segment: `blue-editor-plus` (`!` bash mode with shell echo, slash/`@` autocomplete over the shared editor), `blue-status-git` (git-branch footer entry), `blue-status-context` (context-occupancy footer entry), `blue-pane-activity` (one-row spinner while the attached agent runs), `blue-pane-queue` (the agent's queued inbox messages, plus the keyless action gating the empty-editor Up recall), `blue-pane-todo` (the session's todo list with the global Ctrl-T collapse toggle), and `blue-pane-btw` (the `/btw` side-question pane: forks the live session into a throwaway side agent and renders the exchange). The assembly segment closes the plain baseline: `blue-interaction` (input editor, `/quit` `/resume` `/new` `/fork` `/sessions` `/help` `/theme`, user questions, approvals), `blue-startup` (`@deepseek-ai/dsh-blue-app/startup`, parses `[task]` and `--resume <id>`), and `blue-app` (the Agent driver, reading its launch values through lazy `!!js ctx.blueStartup.*` config interpolation). The plain baseline is the baseline segment plus the assembly segment — the whole enhancement segment can be dropped without breaking it. Bottom panes mount through `blueScreen.addBottomChild` and the loader mounts sibling rows concurrently, so the dock order is pinned by the `blueComponents` activation round rather than raw row order: the two lighter panes carry a row-level `inject: [blueComponents]` pin to join the same round as the transcript row (never `blueStatus` — `/theme` would dispose the handler's own fiber mid-swap), which keeps the dock at footer → panes → editor.

## Model Experience

Indirectly, through the inserted rows: this bundle is a patch-list carrier and contributes no model-visible text of its own beyond the persona override quoted in the patch.

#### KV Cache effect

The persona override is a static prefix; each inserted row's package owns its own prefix effect.

## Known Limitations and Deferred Work

- **No bundle-level limitations known** — the composed profile is exercised end to end by the whole-tree e2e (`tests/e2e.spec.ts`, 29 cases: boot, task runs, typed input, approval overlay with a session-scoped allowance, tabbed questionnaire, editor key semantics, resume, `/theme` palette swap with draft preservation and transcript re-render, the four dock panes, `/help`, `/sessions` + `/new` + `/fork`, `/btw`, teardown) with a scripted mock LLM adapter and core's recording FakeTerminal; only the model and the process terminal are substituted.
