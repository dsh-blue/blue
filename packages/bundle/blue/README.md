# `@dsh-blue/blue`

English | [中文](README.zh.md)

The dsh Blue bundle: the interactive terminal UI profile. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](https://github.com/deepseek-ai/deepseek-harness) and inserts 29 Blue rows in three segments. The plain baseline remains self-contained; enhancements are individually removable. The frontend-runtime `blue-context`, `blue-conversation`, and `blue-transcript-official` rows and the ecosystem `blue-openpencil`/`blue-lark` adapters ship disabled until their dedicated profile receives live acceptance. OpenPencil projects official tool results without signed editor metadata; Lark registers status/retry through official commands and stores no credentials.

## Model Experience

Indirectly, through the inserted rows: this bundle is a patch-list carrier and contributes no model-visible text of its own beyond the persona override quoted in the patch.

#### KV Cache effect

The persona override is a static prefix; each inserted row's package owns its own prefix effect.

## Known Limitations and Deferred Work

- **No bundle-level limitations known** — the composed profile is exercised end to end by the whole-tree e2e (`tests/e2e.spec.ts`, 72 cases: boot, task runs, typed input, approval overlay with a session-scoped allowance, tabbed questionnaire, editor key semantics, resume, `/theme` palette swap with draft preservation and transcript re-render, the four dock panes, `/help`, `/sessions` + `/new` + `/fork`, `/btw`, diff card, terminal card with exit badge, image paste flowing through as image blocks, step-summary rendering, the S23 model family — picker metadata and segment drafts, session-only vs persisted defaults, the resume header tier, `/provider` list/switch, and the Add Provider wizard against the real settings/credentials/pi-ai stack with a fixture discovery endpoint, teardown) with a scripted mock LLM adapter and core's recording FakeTerminal; only the model and the process terminal are substituted.
