# `@dsh-blue/blue`

English | [中文](README.zh.md)

The dsh Blue bundle: the interactive terminal UI profile. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](https://github.com/deepseek-ai/deepseek-harness) and inserts 34 Blue-owned rows: three host-support rows, one private-runtime composition group, and 30 product rows in baseline, enhancement, and assembly segments. The private group keeps management authority and raw app session/projection/action services away from ordinary siblings while the public `bluePluginHost` facade remains available. The locale runtime/settings adapter, projection-backed `blue-conversation`, and `blue-transcript-official` rows are part of the self-contained nine-row baseline; the 15 enhancement rows are individually removable. `blue-context`, `blue-remote`, `blue-openpencil`, and `blue-lark` remain validation-only packages outside the bundle dependency closure.

The bundle owns Blue's complete agent-preset roster. Standard, PTC, and minimal modes track the pinned harness line; `cordis` / 创造模式 carries the Blue-aware persona and capability-scoped plugin guidance. Both `blue` and direct `dsh --profile` launches resolve this immutable bundle payload, without rewriting the host's shared presets. Creative prototypes target API `1.0.0-beta.1` and may add pane, status, command, overlay, and publish-only notification contributions through `bluePluginHost`, or request scoped readonly `session.read` and `session.projections.read` data. Editor extensions and status/editor providers remain Experimental/reference facets; only persisted Blue-owned settings can activate provider candidates. Prototypes cannot resolve `bluePluginControl`, raw session/projection/action services, owner registries, or core feature IDs. A current compatible host durably buffers definition-style registrations across an owner gap, but never queues or replays notices, overlays, gestures, actions, or old callback results. After prototype acceptance, the Agent asks before keeping local code, creating a GitHub repository, or publishing an npm package. The installed `blue-plugin` author command then supplies the machine catalog, canonical local generator, validator, and current/previous Harness packed conformance without requiring a Blue checkout.

## Model Experience

The selected preset supplies the model-visible persona. In creative mode it explicitly identifies Blue and defines the prototype-first, ask-before-persisting workflow.

#### KV Cache effect

The fallback persona is a static prefix; each inserted row's package owns its own prefix effect.

## Known Limitations and Deferred Work

- **No bundle-level limitations known** — the composed profile is exercised end to end by the whole-tree e2e, including the real dynamic Cordis define/run/stop/update chain, with a scripted mock LLM adapter and core's recording FakeTerminal; only the model and the process terminal are substituted.
