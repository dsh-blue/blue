# `@dsh-blue/blue-context`

F3 headless vertical slice for dsh-context semantics. The projection uses the Harness token-meter contract: usage samples replace by turn/step, pressure prefers projected tokens, and context breakdown is optional. It exposes only readonly frontend models and structured actions; it does not import pi-tui or expose a Harness Agent/Session.

The old `blue-status-context` remains the renderer baseline until this slice receives manual TUI acceptance. `ContextFeature.execute({ kind: 'context.refresh' })` now calls the source's structured refresh capability and re-attaches from its authoritative snapshot; absent capability and source errors return structured results. Remove this bridge when the upstream context projection/action contract is available directly to all supported Harness lines.
