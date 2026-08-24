# Seam reference

## What is a seam

The **seam** is Blue's core architectural concept: **a joint deliberately left open for replacement and contribution**. Blue has no literal `Seam` type or `registerSeam()` API — seams take five code forms:

1. **Cordis service + declaration merging** — a `Service` subclass mounted on the `Context` (`ctx.blueScreen`, `ctx.blueStatus`, …); inject and use;
2. **registry + disposer** — `register(entry): () => void`, duplicate ids throw; the plugin fiber's unload rolls everything back ("registration is an effect");
3. **provider replacement** — one active provider (themes), with Cordis auto-reloading every dependent on swap;
4. **module-level seam** — a cross-plugin shared singleton (the shared editor) that senses mounting and remounting through events;
5. **subpath plugin + patch row** — each enhancement is a package subpath export, toggled by a `cordis.patch.yml` row in the composition layer (zero-code customization).

Each seam splits three roles: **definition** (the contract, owned by the host package), **provider / contributor** (the implementation — the plain default is the first registrant), and **consumer** (depends on the contract, never the implementation). This is the mechanical foundation of "everything is a plugin" — your plugins and Blue's built-in enhancements go through the same seams.

## Blue's own seams

Downstream plugins may only import documented contracts and subpaths — never Blue package internals:

| Seam | Entry | Contract | Plain default | What you can do |
| --- | --- | --- | --- | --- |
| Screen mount | `ctx.blueScreen` | `BlueScreen` / `BlueComponent` | — (core capability) | Mount components (`addChild` returns a disposer), open overlays, `setFocus`, request renders |
| Key registration | `ctx.blueKeymap` | `BlueKeymap` / `BlueKeyAction` | — | Register contextual/global keys; conflicts surface at registration, never fight at runtime |
| Component factory | `ctx.blueComponents` | `BlueComponents` | — | Create editor/markdown/select/image components + width/fuzzy pure functions — no pi-tui anywhere |
| Terminal facts | `ctx.blueTerminalInfo` | `BlueTerminalInfo` | — | Read the OSC 11 background probe and keyboard-protocol capabilities |
| Theme | `blueTheme` provider swap | `BlueTheme` (28-token palette) | `blue-theme-dark` | Provide a whole palette; hot-switched by `/theme`, dependents auto-reload |
| Status bar | `ctx.blueStatus` | `BlueStatus` / `BlueStatusEntry` | `blue-status-basic` | Register footer entries (priority / row / align) |
| Render intents | `ctx.blueIntents` | `BlueIntents` / `BlueIntentEntry` | generic tool card | Provide custom cards for new tool kinds (how diff and terminal cards exist) |
| Session facts | `ctx.blueSession` + events | `BlueSession` + `blue/session-changed` etc. | — | Read the current Agent, track switches, trigger resume/new/fork |
| Shared editor | module-level `editor-instance` + `blue/input-editor-changed` | `SharedEditor` / `SubmitTransformer` | factory plain editor | Layer autocomplete providers, `onKey` interception, `insertText`, submit transformers |
| Chrome helpers | `@dsh-blue/blue-core/chrome` subpath | pure functions (no service) | — | Theme-agnostic frame/rule/hint drawing (`framePanel`, `topRule`, …), color functions injected by the caller |
| Composition | `cordis.patch.yml` rows | — | baseline 8 rows | Zero-code toggling and reordering of any plugin row |

## Seams inherited from the harness

Seams the harness (dsh-base) opens — equally open to your plugins:

| Seam | Purpose |
| --- | --- |
| `ctx.commands.register` | Register slash commands, auto-listed in the editor's completion and `/help` |
| `ctx.userQuestions.registerProvider` | Take over the question interaction (questionnaire panels) |
| `'approval/request'` waterfall | Answer approvals (not calling `next()` short-circuits) |
| `attachments` (`AttachmentStore`) | Attachment storage — a pure seam in rc.8, implemented by Blue's `blue-attachments`, consumable by your plugins |
| `ctx.tools` / `ctx.agents` / `ctx.sessions` | Tool registration/guards, session and agent operations |

Harness-side `permissionPresets`, `sessionProjections`, and similar seams are not open in rc.8 — Blue will adapt their presentation as they land.

## Design discipline

1. Every seam: contract owned by the host package, registration returns a disposer, the plain default is the first registrant, unknown inputs fall back to plain;
2. New seams open only when a first real consumer appears — never for hypothetical needs; signatures freeze in P3;
3. Downstream code depends only on documented seams and contract packages, never Blue package internals;
4. plain-first: Blue's own enhancements and downstream plugins register through the same seams; the baseline with every enhancement row removed still works.

::: tip The full engineering catalog
Contract source locations, which file implements each seam, and the row-by-row patch mapping live in the repository's engineering doc [`docs/blue-seams.md`](https://github.com/dsh-blue/blue/blob/master/docs/blue-seams.md) (Chinese).
:::
