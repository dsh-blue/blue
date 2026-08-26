# `@dsh-blue/blue`

English | [中文](README.zh.md)

The dsh Blue bundle: the interactive terminal UI profile. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](https://github.com/deepseek-ai/deepseek-harness) and inserts 28 Blue-owned rows: two host-support rows plus 26 product rows in baseline, enhancement, and assembly segments. The projection-backed `blue-conversation` and `blue-transcript-official` rows are part of the self-contained baseline; the 14 enhancement rows are individually removable. `blue-context`, `blue-remote`, `blue-openpencil`, and `blue-lark` remain validation-only packages outside the bundle dependency closure.

The bundle owns Blue's complete agent-preset roster. Standard, PTC, and minimal modes track the pinned harness line; `cordis` / 创造模式 carries the Blue-aware persona and capability-scoped plugin guidance. Both `blue` and direct `dsh --profile` launches resolve this immutable bundle payload, without rewriting the host's shared presets. Creative prototypes may add dock, status, command, and notification contributions through `bluePluginHost`; they cannot replace Blue core or owner feature IDs. After prototype acceptance, the Agent asks before keeping local code, creating a GitHub repository, or publishing an npm package.

## Model Experience

The selected preset supplies the model-visible persona. In creative mode it explicitly identifies Blue and defines the prototype-first, ask-before-persisting workflow.

#### KV Cache effect

The fallback persona is a static prefix; each inserted row's package owns its own prefix effect.

## Known Limitations and Deferred Work

- **No bundle-level limitations known** — the composed profile is exercised end to end by the whole-tree e2e (`tests/e2e.spec.ts`, 120 cases — 117 active, 3 skipped: boot, task runs, typed input, approval overlay with a session-scoped allowance, tabbed questionnaire, editor key semantics, resume, `/theme` palette swap with draft preservation and transcript re-render, the five dock panes, `/help`, `/sessions` + `/new` + `/fork`, `/btw`, diff card, terminal card with exit badge, image paste flowing through as image blocks, step-summary rendering, the S23 model family — picker metadata and segment drafts, session-only vs persisted defaults, the resume header tier, `/provider` list/switch, and the Add Provider wizard against the real settings/credentials/pi-ai stack with a fixture discovery endpoint, teardown) with a scripted mock LLM adapter and core's recording FakeTerminal; only the model and the process terminal are substituted.
