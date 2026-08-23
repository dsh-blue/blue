# `@dsh-blue/blue-frontend`

Experimental F1 runtime containing renderer-neutral readonly interaction models and the provider host. It must not import pi-tui, React, DOM, ANSI, terminal width, or the legacy Blue UI packages. The host remains alive while providers are swapped and serializes the full `capture -> abort -> dispose -> activate -> restore` lifecycle; activation failure selects the plain provider. Provider resources and late callbacks are scoped by generation and must be disposable.

`ThemeModelService` is the narrow semantic theme registry. It stores immutable token data, exposes activation and subscription, and has no renderer color functions. Renderer adapters may register a model and dispose it with their Fiber.

F5 extends the shared vocabulary without adding renderer state: list items may carry structured actions, status models may select footer row 1/2 and `truncate`/`hide` overflow, and editor models may publish `set`, `submit`, and `abort` actions. These fields remain readonly data; no model contains a Promise, terminal width, focus handle, Agent, Session, ANSI, or renderer object.

The transcript vocabulary is semantic rather than terminal-shaped: user, assistant, thinking, tool, error, interruption, and durable image-reference entries carry ids and readonly facts. A tool entry may embed the existing renderer-neutral `ToolPresentationModel`; it never carries a dsh-tools presenter callback. Generic `View` entries remain accepted for third-party/plain transcript contributions. Renderer plugins own component caching, Markdown, image byte loading, colors, width, and focus.

Adversarial coverage in `tests/adversarial.spec.ts` exercises concurrent provider swaps and verifies that the last requested provider remains active after an activation race. `tests/architecture-boundary.spec.ts` scans all headless source files for renderer/terminal imports and checks the public export surface.
