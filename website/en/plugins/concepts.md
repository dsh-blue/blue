# Core concepts

This page explains the four pillars of Blue's plugin model: the Cordis tree and Fiber lifecycle, capability scoping, the `BlueView` vocabulary, the `BlueResult` error model — plus the domain/adapter split. After reading it you will understand the "why" behind the contract tables on each capability page.

## The Cordis tree and the Fiber lifecycle

There is exactly one Cordis plugin tree inside the dsh process. The Harness domain plugins (agents, sessions, tools, approval), Blue's 28 rows, and your plugin are all sibling rows on this tree:

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

The manifest is a plugin's static compatibility declaration:

```ts
interface BluePluginManifest {
  id: string                    // ^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$
  api: string                   // semver 范围；宿主当前是 1.x 线，写 '^1.0.0'
  capabilities: BlueCapability[] // 不可重复
}
```

`open()` behaves in three layers:

1. **Static validation** (`validateBlueManifest`, without executing plugin code): id format, api range format, capability spelling and deduplication. Failures return `BLUE_API_INCOMPATIBLE` (or `BLUE_INVALID_CONTRIBUTION` when the manifest is not even an object);
2. **Capability-open check**: in the current phase only `commands`, `status`, `dock`, and `notifications` are open. Requesting any of `tools` / `editor` / `panels` / `session.read` / `session.act` rejects the whole open (`BLUE_CAPABILITY_DENIED`) — a rejection, not a degradation;
3. **Capability-scoped return**: only the declared capability fields have values on `BluePluginApi`; the rest are `undefined`. Hence access always takes the optional-chaining shape `api.commands?.register(...)`.

Scoping is a two-way contract: you only get what you declared, and the host only exposes what you declared. When an upgraded plugin wants a new capability, it adds one line to the manifest — a host that is too old fails explicitly at `open()` time instead of erroring at runtime.

## The BlueView vocabulary

All view-shaped contributions (status, dock, notification) share one renderer-neutral vocabulary:

| kind | Shape | Fields |
| --- | --- | --- |
| `text` | a text run | `content`, optional `tone` |
| `fields` | label-value rows | `rows: BlueField[]` (`label` + `BlueInlineSpan[]`) |
| `code` | a code block | `code`, optional `language` |
| `diff` | before/after comparison | `before` / `after` |
| `sections` | titled sections | `sections: BlueSection[]` (`title`, `collapsed` optional; `body` recurses as BlueView) |

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
| `BLUE_CAPABILITY_DENIED` | `open()`: a capability not open in the current phase was requested |
| `BLUE_DUPLICATE_ID` | `register()`: the contribution id is already registered (judged across all plugins) |
| `BLUE_INVALID_CONTRIBUTION` | `register()` / `publish()`: malformed contribution (id characters, missing function field, etc.) |
| `BLUE_ACTION_REJECTED` | `register()`: the id squats on Blue's reserved namespace (the `blue.` / `blue:` / `blue-` / `@dsh-blue/` prefixes) |
| `BLUE_LIMIT_EXCEEDED` | `register()`: dock's `preferredRows` / `minRows` outside 0–20 |
| `BLUE_CAPABILITY_ABSENT` | degradation signal from an optional Harness capability probe — handle as degradation, not a plugin failure |
| `BLUE_ABORTED` / `BLUE_SESSION_UNAVAILABLE` | action aborted / session unavailable (used by session capabilities of later phases) |

Symmetrically, when your `execute()` returns `{ ok: false, code, message }`, the `message` is shown to the user as error text; a thrown exception is backstopped by the bridge layer into `plugin command failed: ...` — but that is a backstop, not a contract: return structured errors on your own.

## The domain/adapter split

`session.read` is not open yet, so plugins currently **cannot** read session content through Blue. When you need Harness-side data, use Cordis service injection — your plugin shares the tree with the Harness domain plugins and can `inject` official Harness services. The recommended split is two packages per renderer:

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

- Contract tables and full examples of the four capabilities: [Commands](/en/plugins/commands) · [Status bar](/en/plugins/status) · [Dock panes](/en/plugins/dock) · [Notifications](/en/plugins/notifications);
- The complete list of Blue's internal projection/action boundaries lives in the [Seam reference](/en/plugins/seams).
