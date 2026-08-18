# `@deepseek-ai/dsh-blue`

English | [中文](README.zh.md)

The dsh Blue bundle: the interactive terminal UI profile. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md); selected via `dsh --profile blue` (template `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-blue']`). The patch overrides the `system-prompt` persona, keeps the shared HMR row off, and inserts five Blue rows: `blue-core` (the tree's only pi-tui adapter: terminal lifecycle plus the `blueScreen`/`blueTheme`/`blueKeymap` services), `blue-transcript` (session-event rendering), `blue-interaction` (input editor, `/quit` and `/resume`, user questions, approvals), `blue-startup` (`@deepseek-ai/dsh-blue-app/startup`, parses `[task]` and `--resume <id>`), and `blue-app` (the Agent driver, reading its launch values through lazy `!!js ctx.blueStartup.*` config interpolation).

## Model Experience

Indirectly, through the inserted rows: this bundle is a patch-list carrier and contributes no model-visible text of its own beyond the persona override quoted in the patch.

#### KV Cache effect

The persona override is a static prefix; each inserted row's package owns its own prefix effect.

## Known Limitations and Deferred Work

- **No assembled smoke yet** — transcript and interaction are developed in parallel, so the composed profile is not yet exercised end to end; the `dsh --profile blue` loader smoke lands in the integration step.
