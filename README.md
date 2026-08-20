# Blue

English | [中文](README.zh.md)

Blue is an interactive terminal UI (TUI) plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): a `pi-tui` renderer mounted as an out-of-tree [Cordis](https://www.npmjs.com/package/@deepseek-ai/cordis) plugin bundle on top of the `dsh-base` bundle. Nothing is published to npm yet — the project lives in this repository as five workspace packages under the `@dsh-blue` scope, and the only way to run it today is a local development install (see [Installation](#installation-development)).

This repository is the standalone home of those packages. They were extracted from the `deepseek-harness` monorepo (`packages/blue/*` and `packages/bundle/blue`) and now build and test against the published npm releases of the harness (`0.1.0-rc.7` line) and vendored Cordis.

## Features

- **Streaming transcript** — user/assistant messages rendered as Markdown while they stream; tool calls as cards, generic by default with dedicated cards for diffs (`intent-diff`) and terminal output (`intent-terminal`).
- **Input editor** — rounded-box editor with fuzzy slash-command autocomplete, argument ghost hints, `!` bash mode, `@` file completion, and Ctrl-V clipboard image paste (`[image #N]` markers split into image blocks on submit).
- **Overlays** — four-option approval panel (with session-level "always allow" inheritance) and tabbed user-questionnaire overlays.
- **Two-row status footer** — `model · status` (priority 0), git branch (priority 10), context occupancy `ctx N` (priority 20); entries are registry contributions, not hardcoded.
- **Bottom dock panes** — activity spinner while the agent runs, queued inbox messages with Up-to-recall, todo list with the Ctrl-T collapse toggle, and a `/btw` side-question pane that forks the live session.
- **Slash commands** — `/quit` `/resume` `/new` `/fork` `/sessions` `/help` `/theme` `/btw`, all auto-listed in the editor's completion menu.
- **Theming** — `/theme` hot-switching across `dark` / `light` / `auto` (OSC 11 background detection) / `custom` (JSON palette).

## Design philosophy

**A TUI is not a package; it is a Cordis plugin tree.** pi's own coding agent collapsed its pi-tui UI into a 6.5k-line `InteractiveMode` god class. Blue's core claim is the opposite organization:

- **Everything is a plugin** — render components, interaction providers, commands, status entries are all separate plugins with their own fiber lifecycles.
- **Registration is an effect** — component mounts, provider registrations, keybindings bind through `ctx.effect`/`ctx.on`, so plugin unload rolls everything back; HMR and session switching come free.
- **Seams with three roles** — every capability is split into definition / provider / consumer. Blue consumes the harness's seams (`agents`, `sessions`, `commands`, `userQuestions`, approval) and opens its own seams for downstream plugins ([docs/blue-seams.md](docs/blue-seams.md)).
- **Dependency-derived loading** — plugins `inject` what they need and wait until the services exist; a provider hot-swap unloads and reloads its dependents automatically.
- **plain-first** (ADR D21) — every non-trivial surface is a seam plus a plain default implementation. Blue's own enhancements register through the same seams as downstream plugins, and the bundle with every enhancement row removed still boots and works.
- **One pi-tui import** — only `packages/core` imports `@earendil-works/pi-tui`. Its breaking changes cannot propagate out of L0, and no contract mentions a pi-tui type.

The full architecture document is [docs/blue-architecture.md](docs/blue-architecture.md) (Chinese); decisions are recorded in [docs/blue-decisions.md](docs/blue-decisions.md).

## Layered architecture

```
┌──────────────────────────────────────────────────────┐
│ L4  composition: bundle/blue — cordis.patch.yml        │  rides on dsh-base
├──────────────────────────────────────────────────────┤
│ L3  render plugins: transcript (folds + status bar)    │  hot-swappable, omissible
├──────────────────────────────────────────────────────┤
│ L2  interaction plugins: input / commands / approval   │  implements harness seams
├──────────────────────────────────────────────────────┤
│ L1  kernel services: blueScreen · blueTheme · …        │  stable core (core package)
├──────────────────────────────────────────────────────┤
│ L0  pi-tui adapter: terminal lifecycle ↔ fibers        │  the tree's only pi-tui import
├──────────────────────────────────────────────────────┤
│ dsh-base (agents / sessions / commands / …)            │
└──────────────────────────────────────────────────────┘
```

Dependencies are strictly one-way: `core ← transcript / interaction ← app ← bundle`.

| Package | Layer | Role |
| --- | --- | --- |
| [`@dsh-blue/blue-core`](packages/core) | L0 + L1 | The tree's only `@earendil-works/pi-tui` adapter: terminal lifecycle plus the `blueScreen` / `blueTheme` / `blueKeymap` / `blueComponents` / `blueTerminalInfo` services. |
| [`@dsh-blue/blue-interaction`](packages/interaction) | L2 | Input editor, slash commands, approval and user-question overlays, plus enhancement subpath plugins (bash mode, image paste, attachments). |
| [`@dsh-blue/blue-transcript`](packages/transcript) | L3 | Folds session events into transcript items and renders them (streamed Markdown, tool cards), the `blueStatus` registry with its footer shell, and dock panes. |
| [`@dsh-blue/blue-app`](packages/app) | L4 | Command-line startup (`[task]`, `--resume <id>`) and the Agent driver publishing `blueSession`. |
| [`@dsh-blue/blue`](packages/bundle/blue) | L4 | The installable bundle: `cordis.patch.yml` inserts the Blue plugin rows over `dsh-base`. |

Each entry point is a Cordis plugin (`export const name`, optional `inject`, `apply(ctx)`); Cordis and the dsh service packages are `peerDependencies` provided by the host `dsh` installation.

## A worked example: the Editor seam

The input editor is the clearest walk through the philosophy. Four roles, four places, no shortcuts between layers:

**1. The contract (L1).** `BlueEditor` is an interface in `packages/core/src/types.ts:437` — it mentions no pi-tui type and no harness type, on purpose:

```ts
export interface BlueEditor extends BlueFocusable {
  onSubmit?: ((text: string) => void) | undefined
  onChange?: ((text: string) => void) | undefined
  onKey?: ((data: string) => boolean) | undefined   // pre-interception hook
  getText(): string
  setBorderColor(color: BlueColorFn): void
  setGhostHint(hint: string | undefined): void
  setAutocompleteProvider(provider: BlueAutocompleteProvider): void
  insertText(text: string): void                    // atomic insert at cursor
  getExpandedText(): string                         // paste markers expanded, used on submit
  // …
}
```

**2. The implementation (L0).** The only way to obtain one is `ctx.blueComponents.createEditor()` (`packages/core/src/types.ts:655`). Inside core, `EditorAdapter` (`packages/core/src/components.ts:162`) wraps the pi-tui `Editor` and post-processes every render through the chrome helpers to draw the rounded box, prompt symbol, and ghost hint. The adapter is the only code that knows pi-tui is involved; a future vim-mode editor could implement the same interface without any consumer noticing.

**3. The consumer (L2).** The `blue-input` plugin (`packages/interaction/src/input-plugin.ts:169`) creates the editor, mounts it as the screen's bottom child (`input-plugin.ts:469`), and publishes it through the shared-editor seam (`editor-instance.ts`) — submit routing, enhancement markers, and the `blue/input-editor-changed` event that lets later plugins find the editor regardless of row order.

**4. The enhancements (L2 subpath plugins).** `blue-editor-plus` layers the `!` bash mode and slash/`@` autocomplete providers over the shared editor; `blue-paste-image` intercepts Ctrl-V through the `onKey` hook, inserts `[image #N]` markers with `insertText`, and expands them on submit through a submit transformer. Neither touches core — they are rows in `cordis.patch.yml` that can be deleted individually, and the plain editor keeps working.

Contract in L1, implementation locked in L0, enhancement through seams in L2: that is what "every surface is a plugin" means in practice. The complete catalog — every seam Blue opens, its contract location, its plain default, and which plugin implements each visual surface — is in [docs/blue-seams.md](docs/blue-seams.md).

## Installation (development)

The only supported install today is local, against a checkout. Prerequisites: Node `^22.19 || >=24`, pnpm 11, and a `dsh` CLI ≥ `0.1.0-rc.7` (`npm i -g @deepseek-ai/dsh`).

### One-shot

```sh
script/install-dev.sh
# overrides: DSH_BIN=/path/to/dsh PROFILE=my-profile DSH_HOME=/custom/home script/install-dev.sh
```

The script builds the workspace and link-installs all five packages into the profile.

### Manual, equivalent

```sh
pnpm install && pnpm run build   # lib/ is the runtime entry of every package

# One-time profile setup:
dsh plugin --profile blue add \
  link:/path/to/blue/packages/bundle/blue \
  link:/path/to/blue/packages/core \
  link:/path/to/blue/packages/interaction \
  link:/path/to/blue/packages/transcript \
  link:/path/to/blue/packages/app

dsh --profile blue [task]           # run a task, or start interactive
dsh --profile blue --resume <id>    # resume a persisted session
```

Why all five links: the four library packages are the bundle's `workspace:^` dependencies, unresolvable outside this workspace. `dsh plugin` forwards verbatim to pnpm, whose `link:` protocol installs the checkout itself as a symlink; the linked bundle then resolves its siblings through the profile's own `node_modules` links. The four non-bundle links are plain dependencies — expect one `declares no dsh.bundle` warning each; they are libraries, not layers.

If your profile was linked before the package rename (when the packages were named `@dsh-blue/blue*`), those links are stale — delete the profile directory (`~/.dsh/profiles/<name>`) or `dsh plugin --profile <name> remove` the old entries, then re-run the script.

### Iteration loop

**edit src → `pnpm run build` → re-run `dsh --profile blue`**. The links point at the package directories, so rebuilt `lib/` takes effect with no reinstall; only a dependency-graph change (adding a package or changing `dependencies`) needs another `dsh plugin --profile blue add`/`install`.

Headless smoke check (pseudo-TTY via `script(1)`):

```sh
(sleep 10; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue" /tmp/blue-smoke.typescript
# Assert: bracketed-paste on (\x1b[?2004h) at boot, off (\x1b[?2004l) at exit, exit code 0.
```

## Development

```sh
pnpm run test           # vitest: unit suites plus the bundle's whole-tree e2e
pnpm run test:coverage  # per-file 100% gate on packages/*/src
pnpm run build          # tsc -b emits lib/types, tsdown bundles lib/
pnpm run lint           # oxlint
pnpm run typecheck      # tsc -b
```

Tests run from source: specs import the package under test through relative `../src/*.ts` paths, and every `@deepseek-ai/*` dependency resolves from `node_modules`.

## Documentation

All design documents are in Chinese, under [docs/](docs/):

- [docs/blue-seams.md](docs/blue-seams.md) — the seam catalog: every seam Blue opens (contracts, plain defaults) and which Blue plugin implements each harness-side visual surface.
- [docs/blue-architecture.md](docs/blue-architecture.md) — architecture: philosophy, L0–L4 layers, stability rules.
- [docs/blue-decisions.md](docs/blue-decisions.md) — decision records (ADR).
- [docs/blue-roadmap.md](docs/blue-roadmap.md), [blue-p1-design.md](docs/blue-p1-design.md), [blue-p2-visual-design.md](docs/blue-p2-visual-design.md), [blue-mvp-plan.md](docs/blue-mvp-plan.md), [blue-commands-plan.md](docs/blue-commands-plan.md) — phase designs and implementation logs (the built-in slash-command checklist: kimi/pi/Claude Code/Codex reference merge, harness capability matrix, S23–S28 phasing, upstream seam requests).
- [AGENTS.md](AGENTS.md) — the authoritative per-package description of the current code.

## Relationship to deepseek-harness

- Runtime and test dependencies (`@deepseek-ai/cordis` 4.0.1, `@deepseek-ai/dsh-*` 0.1.0-rc.7, `@earendil-works/pi-tui` ^0.84.2) come from the npm registry; Blue's own five packages are unpublished and stay workspace-linked here.
- The harness's repository gates (documentation i18n pairing, README gates, snapshot/e2e lanes) do not apply here; this repo keeps the build, the full test suite, and the per-file 100% src coverage gate.
