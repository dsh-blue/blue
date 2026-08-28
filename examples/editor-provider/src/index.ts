/**
 * Inert custom editor shell candidate retaining Blue's editing engine slot.
 *
 * @module @dsh-blue-example/editor-provider
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BlueEditorProvider } from '@dsh-blue/blue-api'
import type {} from '@dsh-blue/blue-api'

export const name = '@dsh-blue-example/editor-provider'
export const inject = ['bluePluginHost']

/** Shell with exactly one host-owned editor-control node. */
export const editorProvider: BlueEditorProvider = {
  id: 'example.editor.focused',
  render: snapshot => ({
    kind: 'surface',
    chrome: 'lane',
    title: snapshot.mode === 'normal' ? 'Message' : `${snapshot.mode} message`,
    badges: [{ text: snapshot.busy ? 'working' : 'ready', tone: snapshot.busy ? 'accent' : 'success' }],
    child: {
      kind: 'stack',
      direction: 'column',
      gap: 1,
      children: [
        { node: { kind: 'editor-control' } },
        { node: { kind: 'text', content: `${String(snapshot.attachments.length)} attachments · ${String(snapshot.extensions.length)} extensions`, tone: 'muted' } },
      ],
    },
  }),
}

/** Add an inert shell candidate without mutating Blue settings. */
export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, { id: name, api: '^1.0.0', capabilities: ['editor.provider'] })
  if (!opened.ok) return
  opened.value.editorProviders!.register(editorProvider)
}
