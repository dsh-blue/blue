# Integrating with Blue: the downstream plugin guide

Blue's extension surfaces are managed by a Cordis plugin host: your plugin declares capabilities, contributes renderer-neutral views/actions, and is rolled back automatically on unload. This page walks a downstream plugin through the full integration path; see the [Seam reference](/en/plugins/seams) for the complete surface map and [Built-in plugins](/en/plugins/builtins) for the bundle's internal composition.

::: warning Preview-stage caveat
Seam signatures are planned to freeze in Phase 3; plugins integrating today may need adaptation across upgrades. This page is kept in sync with every release.
:::

## The integration model: your plugin hangs on the same Cordis tree

Blue is not a standalone application — it is a set of plugin rows on the Cordis plugin tree inside the dsh process. A downstream plugin needs no SDK process, IPC, or config file: it is an ordinary Cordis plugin running in the same tree as Blue's 28 rows:

```text
dsh process (Cordis tree)
├── dsh-base rows        — Harness domain: agents · sessions · tools · approval
├── Blue rows            — the TUI: bluePluginHost is served here
└── your plugin row      — inserted via cordis.patch.yml, injecting bluePluginHost
```

Integration is a single move: **present a manifest to `bluePluginHost`, receive a capability-scoped API, register contributions**. Contributions are data (`BlueView`) and structured actions, not UI components — rendering is done uniformly by Blue's TUI kernel, and your code never touches pi-tui, ANSI, or terminal width.

In the current phase `open()` accepts only four capabilities: `commands`, `status`, `dock`, `notifications`. The manifest schema declares five more (`tools`, `editor`, `panels`, `session.read`, `session.act`); requesting any of them is rejected with `BLUE_CAPABILITY_DENIED` — they are reserved for later phases and their signatures are not settled.

## Step 1: package skeleton

A minimal plugin package looks like:

```text
my-plugin/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts        # plugin entry
```

The key `package.json` fields:

```json
{
  "name": "my-scope/my-plugin",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "dependencies": { "@dsh-blue/blue-api": "^0.1.0-rc.8" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

- `@dsh-blue/blue-api` is the only Blue package you depend on — it is pure contracts (manifest validation + types), with no renderer or terminal code.
- Cordis is provided by the host dsh installation and declared as a peer; **do not** bundle dsh/cordis into your own dependencies, or you get a second service instance.
- The plugin entry is a plain Cordis plugin: export `name` (a stable string), optional `inject` (the plugin stays inactive until the listed services exist), and `apply(ctx)`.

## Step 2: manifest and open()

```ts
import type { Context } from '@deepseek-ai/cordis'
// Empty type import: pulls in the Context.bluePluginHost declaration merge
import type {} from '@dsh-blue/blue-api'

export const name = 'my-plugin.clock'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'my-plugin.clock',        // lowercase namespace id, @scope/ prefix allowed
    api: '^1.0.0',                // semver range against the host's BLUE_API_VERSION (1.x line)
    capabilities: ['status', 'commands'],
  })
  if (!opened.ok) {
    // Structural failure (incompatible version / capability not open):
    // bail out instead of throwing into the host
    return
  }
  const api = opened.value // BluePluginApi: exposes only the declared capabilities
}
```

Key points:

- `open(ctx, manifest)` first runs `validateBlueManifest` (static checks, no plugin code executed), then returns a **capability-scoped** `BluePluginApi` — capabilities you did not declare are `undefined` on it.
- Every failure is a structured `BlueResult` (`{ ok: false, code, message }`); plugin errors never cross the public boundary as thrown objects — and your code should not throw upward either.
- Every returned registration is bound to the caller's Fiber: **unloading the plugin rolls all contributions back** — no cleanup code of your own.

## Step 3: register contributions (the four capabilities)

### `commands` — slash commands

```ts
api.commands?.register({
  id: 'now',                    // i.e. /now; duplicate ids are rejected (BLUE_DUPLICATE_ID)
  label: 'Print the current time',
  execute: async (args, { signal, rawInput } = {}) => {
    // args: whitespace-split arguments; signal: abort signal; rawInput: the raw input line
    return { ok: true, value: undefined }
  },
})
```

Once registered, `/now` appears in the editor's slash completion and `/help` automatically — no extra UI registration. Ids must be lowercase namespace identifiers (dotted ids like `my-plugin.now` work too); the `blue.`, `blue:`, `blue-`, and `@dsh-blue/` prefixes are Blue's reserved owner namespace.

### `status` — status-bar entries

```ts
api.status?.register({
  id: 'clock.status',
  priority: 25,                 // optional metadata; the footer renders entries in registration
                                // order today — priority currently only affects dock panes
  render: () => ({ kind: 'text', content: new Date().toLocaleTimeString(), tone: 'muted' }),
})
```

`render()` returns `BlueView | null` (null hides the entry for that frame). Entries render in the bottom footer; over-wide entries are truncated or hidden, so keep content short.

### `dock` — bottom dock panes

```ts
api.dock?.register({
  id: 'clock.pane',
  view: () => ({ kind: 'fields', rows: [{ label: 'time', value: [{ text: new Date().toLocaleTimeString() }] }] }),
  priority: 40,                 // dock panes sort by priority
  preferredRows: 3,             // preferred row count
  minRows: 1,                   // minimum row count
  collapsible: true,            // may be collapsed
})
```

`view` is a static `BlueView` or a function returning `BlueView | null`. Dock panes sit in the bottom area above the editor (activity/queue/todo/btw/agents are the built-ins).

### `notifications` — notifications

```ts
api.notifications?.publish({
  id: 'clock.tick',             // deduped by id
  view: { kind: 'text', content: 'tick', tone: 'accent' },
})
const sub = api.notifications?.subscribe(notification => { /* ... */ })
```

Publishing and subscribing are both renderer-neutral; whether a notification shows as a toast, status, or log line is the renderer's choice.

## The BlueView vocabulary

All view-shaped contributions share one renderer-neutral vocabulary (`BlueView` from `@dsh-blue/blue-api`):

| kind | shape | fields |
| --- | --- | --- |
| `text` | a text run | `content`, optional `tone` |
| `fields` | label-value rows | `rows: BlueField[]` (`label` + `BlueInlineSpan[]`) |
| `code` | a code block | `code`, optional `language` |
| `diff` | before/after comparison | `before` / `after` |
| `sections` | titled sections | `sections: BlueSection[]` (optional `title`, `collapsed`; `body` recurses as BlueView) |

Color exists only as the semantic `BlueTone`: `default | muted | accent | success | warning | danger`; inline spans (`BlueInlineSpan`) may carry `emphasis: 'strong'`. **Never** embed ANSI escapes or hand-wrap text to a terminal width — width budgeting is the renderer's job, and over-wide content is uniformly truncated.

## BlueResult error codes

Every failure on the public boundary uses one error vocabulary (`BlueErrorCode`):

| code | meaning |
| --- | --- |
| `BLUE_API_INCOMPATIBLE` | the manifest's `api` range is incompatible with the host version |
| `BLUE_CAPABILITY_DENIED` | a capability that is not open was requested (today: anything beyond the four) |
| `BLUE_CAPABILITY_ABSENT` | a probed optional Harness capability is absent — degrade gracefully, not a plugin failure |
| `BLUE_DUPLICATE_ID` | the contribution id is already registered (checked across all consumers) |
| `BLUE_INVALID_CONTRIBUTION` | malformed contribution (id characters, non-integer priority, …) |
| `BLUE_ACTION_REJECTED` | the host rejected the action (e.g. squatting on Blue's reserved namespace) |
| `BLUE_LIMIT_EXCEEDED` / `BLUE_ABORTED` / `BLUE_SESSION_UNAVAILABLE` | limit hit / aborted / no session |

## Where data comes from: the domain/adapter split

`session.read` is not open yet, so plugins **cannot** read session content through Blue today. When you need Harness-side data, use Cordis service injection — your plugin shares the tree with the Harness domain plugins and can `inject` official Harness services (`ctx.sessions`, `ctx.commands`, …). The recommended split per renderer:

```text
@scope/feature        domain package: shared by headless/Web/TUI, injects no Blue services
@scope/feature-blue   Blue adapter package: injects bluePluginHost, contributes UI only
```

That way a headless profile (a tree without Blue) can load the domain package without pending. When a probed optional capability is absent in the adapter, degrade — skip the contribution instead of stalling the tree.

Hard rules: never import Blue package internals (the public contracts of `@dsh-blue/blue-api` only); never hold Agent, Session, or renderer objects; no module-level singletons for product state (multiple frontend trees would share it).

## Step 4: install into a profile for local debugging

1. Insert a row into the profile's `cordis.patch.yml` (rows can be added, removed, reordered — zero-code customization):

```yaml
- id: my-plugin-clock
  name: 'my-scope/my-plugin'
```

2. During development, link-install it:

```sh
dsh plugin --profile blue-dev add link:/path/to/my-plugin
dsh --profile blue-dev
```

3. Iteration loop: edit → rebuild your package → restart the profile (or rely on dsh's HMR, depending on your package shape). Verify unload semantics: remove your row from the patch and every contribution should disappear without residue.

## Step 5: validation

The Blue repository ships two scripts (clone the Blue repo to run them):

```sh
node script/blue-plugin-validate.mjs /path/to/my-plugin          # static structure & boundary checks
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install # packed-install contract fixture
```

- `validate` prints a JSON report in three groups: package (manifest, exports, files), architecture (dependency direction, forbidden imports), lifecycle (Fiber binding).
- `fixture` packs and installs your plugin into a throwaway npm project, verifying real behavior under an independent install.

## Publishing

A plain npm package is enough: `npm publish` (during the preview, align a dist-tag like `@rc` with the Blue line). The user install path is `dsh plugin --profile blue add my-scope/my-plugin` — a package without a `dsh.bundle` declaration installs as a plain dependency only, so tell your users to add your plugin row to the profile's `cordis.patch.yml`. A marketplace (one-command install, discovery) is on the roadmap — see the [marketplace](/en/marketplace/).

## Next steps

- [Seam reference](/en/plugins/seams) — the full map of the stable plugin host and Blue's internal projection/action/model boundaries;
- [Built-in plugins](/en/plugins/builtins) — the bundle's 28 Blue-owned rows, the most complete set of plugin examples;
- [Contributing to this repo](/en/plugins/contributing) — the local development flow for contributing to Blue itself.
