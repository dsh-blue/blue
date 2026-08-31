# Core concepts

This page explains the four pillars of Blue's plugin model: the Cordis tree and Fiber lifecycle, capability scoping, the canonical-node vocabulary, and the `BlueResult` error model — plus the domain/adapter split. After reading it you will understand the "why" behind the contract tables on each capability page.

## The Cordis tree and the Fiber lifecycle

There is exactly one Cordis plugin tree inside the dsh process. The Harness domain plugins (agents, sessions, tools, approval), Blue's 34 owned rows (including its private runtime group), and your plugin are all composition rows on this tree:

```text
dsh process 进程（one Cordis tree 一棵 Cordis 树）
├── dsh-base rows 行    — Harness domain: agents · sessions · tools · approval
├── Blue rows 行        — TUI: bluePluginHost serves here 在这里提供服务
└── your plugin row 你的插件行 — inserted via 经 cordis.patch.yml
```

Rows communicate only through **Cordis service injection** (`inject` + `ctx.<service>`) and **request events** — they share no object references. Once your plugin declares its dependency with `inject: ['bluePluginHost']`, Cordis guarantees the host is in place before activating your `apply(ctx)`.

Every plugin runs on its own **Fiber**. Each registration returned by `open(ctx, manifest)` binds to the caller's Fiber:

- when the plugin is unloaded (its patch row removed, the profile switched), all contributions **roll back automatically**, leaving no residue;
- conversely, if you bypass `open()` and mutate global state directly (a module-level singleton, registering straight onto a Harness service), the unload semantics break — that is why [Design discipline](#design-discipline) forbids them.

## Capability scoping

The canonical manifest is a plugin's static compatibility and least-authority declaration:

```ts
interface BluePluginManifestV1 {
  $schema: 'https://dsh-blue.dev/schema/blue.plugin.v1.schema.json'
  schemaVersion: 1
  id: string
  entry: string
  api: string
  compatibility: { blue: string; harness: string; node: string }
  capabilities: {
    required: BluePluginCapabilityRequestV1[]
    optional: BluePluginCapabilityRequestV1[]
  }
}
```

`open()` behaves in three layers:

1. **P1 machine validation**: `validateBluePluginManifestV1` applies the Draft 2020-12 schema and semantic rules to identity, public export entry, API/product compatibility, required/optional groups, resources, and duplicate capabilities. A successful value is detached and deeply frozen;
2. **P2 atomic negotiation**: one unavailable required capability rejects the whole admission. Optional capabilities may be partially admitted; the host returns grants carrying versions, exact resources, limits, quotas, availability, and owner generation, plus structured `unavailableOptional` records;
3. **Grant-scoped return**: `BluePluginOpen.api` exposes facades only for granted capabilities. Use `opened.value.api.commands?.register(...)` and check every returned `BlueResult`.

Scoping is a two-way contract: you only get what you declared, and the host only exposes what you declared. When an upgraded plugin wants a new capability, add one exact request to `required` or `optional`. A host version, policy, or owner mismatch then fails or degrades explicitly at `open()` time instead of surfacing later at runtime.

::: info Transition lane
The old flat `{ id, api, capabilities: string[] }` shape remains only for PR #77 compatibility examples. It has no canonical resource/grant/denial semantics and must not be used for new plugins. Any manifest carrying `$schema` must pass the canonical parser and never falls back.
:::

Buffering stores only inert contributions; it grants no renderer or dispatch authority. The active frontend-tree owner still owns provider selection, rendering, gestures, LKG/breaker state, and fallback. Each owner attach receives a private generation-bound lease; overlap on any capability atomically revokes every capability of the displaced lease, so late callbacks, gestures, and overlay closes are rejected by generation. Reload replays only definition snapshots, never overlays, notifications, or actions. Unloading the consumer Fiber immediately removes its registrations.

## The canonical-node vocabulary

Panes, overlays, and providers use `BlueUiNode`; status uses its non-interactive
`BlueStatusNode` subset; notifications retain the lightweight `BlueView`
subset. All three share the renderer-neutral content leaves below:

| kind | Shape | Fields |
| --- | --- | --- |
| `text` | a text run | `content`, optional `tone` |
| `fields` | label-value rows | `rows: BlueField[]` (`label` + `BlueInlineSpan[]`) |
| `code` | a code block | `code`, optional `language` |
| `diff` | before/after comparison | `before` / `after` |
| `sections` | titled sections | `sections: BlueSection[]` (`title`, `collapsed` optional; `body` recurses as BlueView) |

The full `BlueUiNode` vocabulary also includes rich text, stacks, surfaces,
scroll, tabs, lists, forms, actions, loaders, empty states, progress, spacers,
and dividers. See the [public UI kit](/en/plugins/ui-kit) for the builder
overview and the [UI node reference](/en/plugins/ui-reference) for the complete
field contracts.

Styling has only two dimensions:

- the semantic tone `BlueTone`: `default | muted | accent | success | warning | danger` — the renderer maps it to the current theme's colors; you never pick color values;
- the inline emphasis `BlueInlineSpan.emphasis: 'strong'`.

**Never** embed ANSI escapes in text, and never hand-wrap text to a terminal width. Width budgeting is the renderer's job: over-wide content is uniformly truncated, while text with embedded ANSI breaks the width math and dirties the theme.

## The BlueResult error model

Every failure on the public boundary is a structured `BlueResult` and never crosses as an exception:

```ts
type BlueResult<Value = void> =
  | { ok: true, value: Value }
  | { ok: false, code: BlueErrorCode, message: string }
```

| code | Where it appears |
| --- | --- |
| `BLUE_API_INCOMPATIBLE` | `open()`: an illegal manifest field, or the `api` range is incompatible with the host version |
| `BLUE_CAPABILITY_DENIED` | legacy inline `open()`: a facet absent from the transition host was requested |
| `BLUE_CAPABILITY_UNSUPPORTED` | canonical `open()`: a required capability is absent from this composition |
| `BLUE_CAPABILITY_VERSION_UNSUPPORTED` | canonical `open()`: a required capability version range does not intersect |
| `BLUE_POLICY_DENIED` | canonical `open()`: Host policy rejects a required capability |
| `BLUE_RESOURCE_DENIED` | canonical `open()` / facade: resource kind, count, or exact grant is not satisfied |
| `BLUE_DUPLICATE_ID` | `register()`: the contribution id is already registered (judged across all plugins) |
| `BLUE_INVALID_CONTRIBUTION` | `register()` / `publish()`: malformed contribution (id characters, missing function field, etc.) |
| `BLUE_ACTION_REJECTED` | `register()`: the id squats on Blue's reserved namespace (the `blue.` / `blue:` / `blue-` / `@dsh-blue/` prefixes) |
| `BLUE_LIMIT_EXCEEDED` | `register()` / `open()` / `publish()` / `refresh()`: contribution, pane/overlay, size, or rolling-rate quota exceeded |
| `BLUE_CAPABILITY_ABSENT` | an active notification/session/projection-read owner or backing key is absent, or this host/profile does not provide the capability; handle as a version/profile mismatch or optional degradation |
| `BLUE_STALE` | the owner/session generation advanced, rejecting an old action, event, snapshot, or callback result |
| `BLUE_ABORTED` | command/event work was cancelled by its signal, unload, refresh, or session change |
| `BLUE_INTERNAL_FAILURE` | an owner read/adapter failed behind containment; record diagnostics and degrade instead of retrying in a loop |

Symmetrically, when your `execute()` returns `{ ok: false, code, message }`, the `message` is shown to the user as error text; a thrown exception is backstopped by the bridge layer into `plugin command failed: ...` — but that is a backstop, not a contract: return structured errors on your own.

## The domain/adapter split

`session.read` exposes an exact-field current-session summary fenced by epoch/revision; `session.projections.read` exposes exact-key JSON projection cuts fenced by epoch/seq. Generic `session.act` has been removed; writes must use the public Harness service, command, or feature action that owns their semantics. See [Read-only session data](/en/plugins/session). Use official Cordis services for fuller Harness-domain data rather than reading Blue owner-only backing services. The recommended split is two packages per renderer:

```text
@scope/feature        Domain 包：headless/Web/TUI 共用，不 inject 任何 Blue 服务
@scope/feature-blue   Blue adapter 包：inject bluePluginHost，只做 UI 贡献
```

That way a headless profile (a tree without Blue) can load the domain package without pending on a service that does not exist. When a probed optional capability turns out absent in the adapter, degrade: skip the corresponding contribution instead of stalling the whole tree.

Blue's own validation-only packages (`blue-context`, `blue-remote`, `blue-openpencil`, `blue-lark`) are the official examples of this shape — see [Built-in plugins](/en/plugins/builtins).

## Design discipline

These bottom lines are enforced jointly by the validate script and code review:

- do not import Blue package internals — use only the public contracts of `@dsh-blue/blue-api`;
- do not hold Agent, Session, or renderer objects — data flows through Cordis services, UI through contributions;
- no module-level singletons for product-grade mutable state (multiple frontend trees would share it);
- no ANSI escapes embedded in view text, no hand-wrapping to a terminal width;
- degrade on absent optional capabilities (skip the contribution) instead of blocking the whole tree.

## Next steps

- Contract tables and complete examples for the current Beta capabilities: [Commands](/en/plugins/commands) · [Status](/en/plugins/status) · [Panes](/en/plugins/dock) · [Notifications](/en/plugins/notifications) · [Read-only session data](/en/plugins/session). Editor extensions, editor providers, and the exclusive status provider remain Experimental/reference surfaces;
- The complete list of Blue's internal projection/action boundaries lives in the [Seam reference](/en/plugins/seams).
