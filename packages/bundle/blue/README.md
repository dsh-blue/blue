# `@dsh-blue/blue`

English | [中文](README.zh.md)

The dsh Blue bundle: the interactive terminal UI profile. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](https://github.com/deepseek-ai/deepseek-harness) and inserts 30 Blue-owned rows: two host-support rows plus 28 product rows in baseline, enhancement, and assembly segments. The projection-backed `blue-conversation` and `blue-transcript-official` rows are part of the self-contained baseline; the 15 enhancement rows are individually removable. `blue-context`, `blue-remote`, `blue-openpencil`, and `blue-lark` remain validation-only packages outside the bundle dependency closure.

The bundle owns Blue's complete agent-preset roster. Standard, PTC, and minimal modes track the pinned harness line; `cordis` / 创造模式 carries the Blue-aware persona and capability-scoped plugin guidance. Both `blue` and direct `dsh --profile` launches resolve this immutable bundle payload, without rewriting the host's shared presets. Creative prototypes may add dock, status, command, and notification contributions through `bluePluginHost`; they may also register inert `status.provider` and `editor.provider` candidates, but only the persisted `blue.statusProvider` and `blue.editorProvider` user choices can activate them. They cannot resolve Blue's owner registries or replace core feature IDs. A capability is available only while its owner bridge is mounted, and an incomplete/old profile returns `BLUE_CAPABILITY_ABSENT` instead of accepting an invisible contribution. After prototype acceptance, the Agent asks before keeping local code, creating a GitHub repository, or publishing an npm package.

## Model Experience

The selected preset supplies the model-visible persona. In creative mode it explicitly identifies Blue and defines the prototype-first, ask-before-persisting workflow.

#### KV Cache effect

The fallback persona is a static prefix; each inserted row's package owns its own prefix effect.

## Known Limitations and Deferred Work

- **No bundle-level limitations known** — the composed profile is exercised end to end by the whole-tree e2e, including the real dynamic Cordis define/run/stop/update chain, with a scripted mock LLM adapter and core's recording FakeTerminal; only the model and the process terminal are substituted.
