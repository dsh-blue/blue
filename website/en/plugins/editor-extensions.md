# Editor extensions

> Status: **Experimental / reference**. `editor.extensions` retains its mature runtime and fixtures for collaborative validation, but it is not part of the Stable v1 root. Its name and contract may change until real-consumer evidence is complete.

The code on this page uses the legacy inline transition manifest. The P1
canonical schema rejects this facet; do not mix it into a new plugin's
canonical request alongside the seven Public Beta capabilities.

`editor.extensions` adds renderer-neutral hints, diagnostics, completions, actions, and submit transforms around Blue's owned editing engine. Extensions cannot read the draft, history, cursor, or IME state and cannot replace the engine. Replacing the whole shell belongs to the exclusive `editor.provider` capability and is outside this surface.

## Registration

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'

export const name = 'acme.editor-helper'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'acme.editor-helper',
    api: '^1.0.0-beta.2',
    capabilities: ['editor.extensions'],
  })
  if (!opened.ok || opened.value.editorExtensions === undefined) return

  opened.value.editorExtensions.register({
    id: 'acme.editor-helper.main',
    priority: 40,
    hint: 'Repository issue keys can be completed with #',
    diagnostics: [{ id: 'privacy', message: 'Review secrets before submitting', tone: 'warning' }],
    actions: [{ id: 'insert-template', label: 'Insert template', intent: 'secondary' }],
    onEvent: async (event) => {
      if (event.kind === 'activate' && event.controlId === 'insert-template') {
        // Dispatch a structured host action here. Raw editor input is unavailable.
      }
      return { ok: true, value: undefined }
    },
    completeV2: async (request) => {
      if (request.trigger !== '#') return { ok: true, value: [] }
      return {
        ok: true,
        value: [{ id: 'issue-72', label: '#72 UI API', insertText: '#72', detail: 'open issue' }],
      }
    },
    transformSubmit: async (request, context) => {
      if (context.signal.aborted) return { ok: false, code: 'BLUE_ABORTED', message: 'submission changed' }
      return { ok: true, value: { text: request.text.replaceAll('WIP', 'work in progress') } }
    },
  })
}
```

Registration only stores the contribution. It does not call `complete`, `completeV2`, `transformSubmit`, or `onEvent`. A mounted or reloaded Blue owner replays registrations that are still live, and the plugin Fiber automatically withdraws them on unload.

## Shell and actions

`before` and `after` accept recursive `BlueEditorExtensionNode` values: text, rich text, fields, code, diff, sections, progress, spacer, divider, and stacks or surfaces containing only those nodes. They are passive content. Interactive commands belong in `actions`, and `onEvent` receives the original action id.

Blue validates, copies, and freezes each contribution before compiling the shell around the same owned editor. A bad contribution never receives a renderer object and cannot hide or duplicate the editor. Extension refresh, session or theme changes, and owner unload abort pending events, completions, and submissions; late results are discarded.

`onEvent` runs only after an explicit user action. Its context carries `surfaceId` as the extension contribution id and may carry a one-shot `userGesture` proof for opening a capturing overlay in the same legitimate asynchronous call chain. The proof expires when the callback settles or the owner unloads. Actions are FIFO within one extension; separate extensions do not block each other.

## Completion

The current Beta compatibility callback `complete` receives `/`, `@`, and `manual` triggers only. Use `completeV2` to opt into the same triggers plus `#`; when both callbacks exist, Blue invokes only `completeV2`. Blue merges public results with the built-in slash, file, and skill sources, accepts only the latest request, and applies each item with its own prefix. Item ids must be unique within one result; label, insertText, detail, and item count are bounded. Invalid, timed-out, aborted, or stale results never reach the dropdown.

## Submit transforms and attachments

Submit transforms run serially in lower-priority-first order before the editor clears. While a transform is pending, the draft, paste table, undo state, and history cursor remain intact. A rejected, timed-out, aborted, or invalid transform cancels the attempt and preserves the draft. Blue submits and clears the editor only after the whole chain succeeds.

A transform can return only `{ text }`. `request.attachments` is the same frozen, readonly metadata snapshot on every step. Known `[image #N]` markers are removed from plugin-visible text; unknown markers remain ordinary text. After success, Blue assembles the final text followed by image blocks in their original marker order. A failed follow-up or safe retraction restores unconsumed attachments.

Every callback context uses the contribution id as `surfaceId`. Its `revision` is monotonic only within the current editor runtime generation, may restart after a runtime/theme reload, and exists solely to correlate current owner work; it is not a persistent host revision. `userGesture` is supplied only to `onEvent`, never to completion or submit transforms.

Plugins must observe `context.signal` and stop promptly. Blue also enforces owner deadlines as a backstop: 5 seconds for completion and 30 seconds for actions and submit transforms. A deadline is not permission to continue background side effects.
