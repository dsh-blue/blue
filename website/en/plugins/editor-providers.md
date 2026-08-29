# Editor providers

> Status: **Experimental / reference**. `editor.provider` is not part of the Stable v1 root. The current implementation retains provider-swap, fallback, and lifecycle evidence, but makes no stable compatibility promise before collaboration with real external consumers.

`editor.provider` registers a candidate that can replace the whole editor shell. A provider may rearrange mode information, auxiliary content, and structured actions, but Blue still owns the editing engine: draft, cursor, history, undo, IME, paste, attachments, and submission never move into plugin code.

## Quickstart

This plugin uses only the public `@dsh-blue/blue-api` contract. It writes renderer-neutral nodes directly and imports neither core, pi-tui, nor repository internals:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { BlueEditorProvider } from '@dsh-blue/blue-api'
import type {} from '@dsh-blue/blue-api'

export const name = 'acme.focused-editor'
export const inject = ['bluePluginHost']

const provider: BlueEditorProvider = {
  id: 'acme.focused-editor.shell',
  render: snapshot => ({
    kind: 'stack',
    direction: 'column',
    gap: 1,
    children: [
      {
        node: {
          kind: 'rich-text',
          spans: [
            { text: snapshot.mode, tone: 'accent', emphasis: 'strong' },
            { text: snapshot.busy ? ' · working' : ' · ready', tone: 'muted' },
          ],
        },
      },
      { node: { kind: 'editor-control' } },
      {
        node: {
          kind: 'text',
          content: `${snapshot.attachments.length} attachments · ${snapshot.extensions.length} extensions`,
          tone: 'muted',
        },
      },
    ],
  }),
}

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'acme.focused-editor',
    api: '^1.0.0-beta.1',
    capabilities: ['editor.provider'],
  })
  if (!opened.ok || opened.value.editorProviders === undefined) return

  const registered = opened.value.editorProviders.register(provider)
  if (!registered.ok) ctx.logger.warn(registered.message)
}
```

Registration only adds a candidate; it never takes over the current editor. The user must select it explicitly in `settings.yaml`:

```yaml
blue:
  editorProvider: acme.focused-editor.shell
```

Set it back to `blue.default` to restore the built-in shell. Installing a provider, reloading the same id, or refreshing a registration never rewrites settings or changes the user's selection automatically.

## Contract

```ts
api.editorProviders?.register(provider: BlueEditorProvider): BlueResult<BlueRefreshRegistration>
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | globally unique candidate id outside Blue's reserved namespaces |
| `render` | `(snapshot: BlueEditorSnapshot) => BlueEditorShellNode` | synchronously returns the whole shell; keep it pure, cheap, and free of I/O |
| `onEvent` | `BlueUiEventHandler?` | optional structured event handler; receives no raw key or renderer object |

`BlueEditorSnapshot` is a frozen readonly value containing only:

- `mode`: `normal | plan | yolo`;
- `busy`: whether the main session is running;
- `attachments`: readonly metadata for attachments admitted from the current draft;
- `extensions`: passive snapshots of admitted `editor.extensions` contributions.

The snapshot contains no draft text, cursor, history, undo stack, or IME state. A provider cannot read those values through the public API.

## The `editor-control` invariant

Every shell must contain exactly one visible `{ kind: 'editor-control' }`. It is the only mounting slot for Blue's owned editing engine, is not an ordinary `BlueUiNode`, and cannot appear in a pane or overlay.

Blue rejects a candidate before activation when it:

- omits `editor-control`;
- contains two or more `editor-control` nodes;
- hides the control with a `when` condition;
- hides the control behind zero-size child constraints;
- returns an invalid node, throws, or produces a runtime failure during dry render.

Blue first compiles and dry-renders at the editor's real width, then suspends input dispatch, atomically replaces the shell, restores the same editor object and focus, and forces a repaint. The provider replaces the shell, never the editing engine.

## Events and lifecycle

A provider may place canonical actions, lists, tabs, or form controls in its shell and receive semantic events through `onEvent`. The event context carries an owner-managed `signal`, `revision`, and a `userGesture` scoped to that user dispatch. Ordinary actions run serially per provider id; value, selection, and tab changes use latest-wins. Callbacks have a 30-second bound, and swaps, refreshes, unload, aborts, and late results cannot mutate the current shell.

Registration and invocation are separate: registration, host snapshots, and owner replay never call `render` or `onEvent`. A provider registration belongs to the caller's Cordis Fiber. Unloading the plugin removes its candidate but does not delete the desired `blue.editorProvider` id; a later provider with the same id can satisfy the original selection again.

## Failure and fallback

- Desired id absent, invalid, or failing on first activation: keep `blue.default`;
- switching from healthy A to broken B: retain A as the current last-known-good shell;
- runtime failure in an active provider: roll back to the pre-swap shell;
- three failures from one candidate generation in a rolling 60-second window: open a timer-free breaker and return to `blue.default`; only a successfully committed live frame from the latest generation resets the budget, while dry-render success and retained LKG frames do not; switching away and back, or a new generation under the same id, permits another attempt.

Every path preserves the settings value. A provider failure cannot clear the draft, consume attachments, break the submit barrier, or block the Agent loop.

## Relationship to editor extensions

`editor.extensions` is additive; `editor.provider` is the one user-selected shell. Blue attempts to compose admitted extensions around the provider shell and includes their passive information in the snapshot. A provider never invokes extension callbacks and cannot bypass their abort, timeout, or stale fences. When all you need is a hint, completion source, diagnostic, action, or submit transform, use [Editor extensions](/en/plugins/editor-extensions).

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| registration succeeds but the UI does not change | candidates are inert; `blue.editorProvider` does not select this id |
| `open()` returns `BLUE_CAPABILITY_ABSENT` | this profile lacks durable editor-provider registration support; upgrade or repair the Blue composition |
| selection falls back to the default shell | the shell violates the single-visible-control invariant, compile/dry-render failed, or the breaker is open |
| the provider needs to read or rewrite the draft | public providers do not own the editing engine; use an `editor.extensions` submit transform for text processing |
| the provider tries to listen for raw keys | the public boundary delivers only structured `BlueUiEvent`; raw terminal input belongs exclusively to core |

See the [configuration guide](/en/guide/config#blue-blues-own-settings-section) for selection and the [Seam reference](/en/plugins/seams) for the internal owner mapping.
