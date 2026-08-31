# Component model

This page walks through the full loop of Blue's controlled UI components: how
a plugin holds state, what `render()` produces, how events flow back, and what
the renderer provides for editing and focus. Per-field API and screenshots
live in the [UI node reference](/en/plugins/ui-reference); the builders and
reusable components live in the [Public UI kit](/en/plugins/ui-kit).

## Mental model

Blue components are **controlled**: the plugin owns the truth.

- Every `render()` returns a **fresh, immutable wire-node tree** built from
  the plugin's own view state. `ui.*` builders recursively copy and
  deep-freeze their inputs; there is no mutable widget handle anywhere in a
  node.
- There is no "grab the component instance and call setValue". To change the
  UI, the plugin updates its own state and lets Blue call `render()` again —
  automatically after a successful event, or through the pane/overlay handle's
  `refresh()` for external changes.
- The renderer owns validation, layout, themes, width, focus, input routing,
  and event dispatch. Nodes never accept renderer callbacks, raw keys,
  terminal coordinates, ANSI, or focus handles, and `render()` performs no
  I/O.

The `examples/ui-gallery` pane is the extreme case: it keeps no mutable state
at all and rebuilds the same static tree from pure builder calls on every
`render()`.

## State and event loop

Interactive nodes (tabs/list/form/actions, plus loader and cancel controls)
receive canonical state from the plugin and emit a proposed next state. The
loop is always the same four steps:

1. The plugin renders from its current state: a tabs node's `activeId`, a
   list's `selectedIds`, and every form field's `value` all come from the
   plugin's own view state.
2. A user operation makes the renderer dispatch a `BlueUiEvent` to the
   `onEvent()` on the contribution/request. The event only describes a
   proposal; it mutates no plugin state.
3. The plugin validates the event, writes accepted values into its own state
   (calling the owning domain service/action as needed), and returns a
   `BlueResult`.
4. After handler success Blue automatically rerenders. Failure, abort,
   timeout, an old generation, or a result after unload cannot commit.

Event payloads (the contract types from `@dsh-blue/blue-api`):

```ts
type BlueUiEvent =
  | { kind: 'activate', controlId: string }
  | { kind: 'selection-change' | 'value-change', controlId: string, value: BlueJson }
  | { kind: 'submit', controlId: string, values: BlueJson }
  | { kind: 'tab-change', controlId: string, tabId: string }
  | { kind: 'dismiss' }
```

For `value-change`, the `value` type follows the field kind: `string` for
input/textarea/secret, `string | null` for select, and `boolean` for toggle.
A multiple list's `selection-change` carries the proposed complete `string[]`
after toggling the item; `submit` carries the current draft values keyed by
field id.

Dispatch order: `value-change`, `selection-change`, and `tab-change` are
latest-wins per control id — a burst of keystrokes keeps only the newest
proposal. `activate`, `submit`, and `dismiss` are FIFO per surface.

A minimal closed loop (tabs):

```ts
let activeTab = 'summary'

const render = () => ui.tabs({
  id: 'settings-tabs',
  activeId: activeTab,
  items: [
    { id: 'summary', label: 'Summary' },
    { id: 'advanced', label: 'Advanced' },
  ],
})

const onEvent = (event: BlueUiEvent) => {
  if (event.kind === 'tab-change' && event.controlId === 'settings-tabs') {
    activeTab = event.tabId
  }
  return { ok: true, value: undefined } as const
}
```

When an external projection, service subscription, or timer changes state,
call the pane/overlay handle's `refresh()`. Never refresh manually on a
successful `onEvent()` path — that counts as an external replacement and can
abort the event's own generation.

## Editing-state semantics

While text is being edited, the renderer keeps a draft within the current
surface generation and continuously emits `value-change`; the plugin should
still write accepted values back into its view state. Recreating the surface
or changing the canonical value externally resets to the plugin's value — a
draft never overrides canonical state.

Current TUI editing keys:

- Text fields (input/textarea/secret): the first `Enter` enters edit state,
  and the next `Enter` confirms and returns to the field's navigation state;
  a textarea inserts a newline with `Alt+Enter`.
- Select: the first `Enter` opens an adjustment state shown as `‹ value ›`.
  `←`/`→` changes only a renderer-local candidate; another `Enter` emits a
  single `value-change`. `Esc` or `Tab` cancels and restores the value
  captured on entry — an unconfirmed candidate never reaches the plugin.
- `↑`/`↓` switches form fields only outside the adjustment state.

## Focus and contextual hints

The TUI derives key hints from canonical control roles; plugins should not
hand-write generic keyboard tutorials in a surface footer:

- `Tab`/`Shift-Tab` cycles semantic groups in tree order and remembers each
  group's last focused item.
- `←`/`→` moves inside tabs/actions; `↑`/`↓` moves inside lists/forms.
- Tabs and single lists activate with `Enter`, multiple lists toggle with
  `Space`, and actions accept `Enter` or `Space`.
- A pending-confirm action switches the hint to `Enter confirm · Esc cancel`;
  text/select editing and adjustment states switch their hints in place too.

The hint row appears only while the focused plugin pane or an open capturing
overlay owns input. At most three semantic fragments are shown; narrow layouts
first shrink to complete compact key tokens, then drop whole fragments —
never clipping half an instruction. Local counts, progress, risk, and business
state still belong in the footer; generic key teaching does not.

## Constraints and lifecycle

- **Schema and quotas**: one tree holds at most 256 nodes, with the root at
  depth 0 and maximum depth 8; any array holds at most 200 entries; strings
  across the tree total at most 20,000 UTF-16 code units. Host admission
  accepts only plain objects and dense arrays and strips ANSI, C1, and unsafe
  control characters. Full rules:
  [Shared rules and limits](/en/plugins/ui-reference#shared-rules-and-limits).
- **Surface compatibility**: not every surface accepts interactive controls —
  panes and capturing overlays accept the full `BlueUiNode`, while
  non-capturing overlays and status allow only passive subsets. See the
  [Surface compatibility matrix](/en/plugins/ui-reference#surface-compatibility-matrix).
- **Capability admission**: rendering a pane or overlay requires declaring the
  `panes`/`overlays` capability in the manifest. The host may reject `open()`
  outright; when a required capability is unsatisfiable, admission fails
  atomically — there is no partially registered state.
- **Fiber unload**: every registration is bound to the caller's Fiber. When
  the plugin unloads (patch row removed, profile switched), all contributions
  roll back automatically and late event results are rejected by generation.

## Where next

- Per-node fields, defaults, event payloads, and screenshots:
  [UI node reference](/en/plugins/ui-reference)
- The `ui` builder and `defineBlueComponent()`:
  [Public UI kit](/en/plugins/ui-kit)
- Runnable complete plugins: [Example catalog](/en/plugins/examples)
