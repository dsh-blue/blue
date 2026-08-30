/**
 * Public editor-provider capability owner and persisted selection bridge.
 * Candidate callbacks remain inert in blue-api; the mounted editor runtime
 * alone validates, dry-renders, and atomically activates the selected shell.
 *
 * @module @dsh-blue/blue-interaction/editor-provider-owner
 */

import type { Context } from '@deepseek-ai/cordis'
// Carries the optional settings service and settings/updated event merges.
import type {} from '@deepseek-ai/dsh-settings'
import {
  type BlueEditorProvider,
  type BlueResult,
  type BlueUiEvent,
} from '@dsh-blue/blue-api'
import {
  clearEditorProviders,
  setEditorProviders,
  type EditorProviderBinding,
} from './editor-instance.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted by the sole Blue settings owner when its resolved source is live. */
    'blue/settings-source-ready'(value: unknown): void
  }
}

/** Stable id selecting Blue's built-in editor shell. */
export const BLUE_DEFAULT_EDITOR_PROVIDER = 'blue.default'
/** Stable Cordis plugin name. */
export const name = 'blue-editor-provider-owner'
/** The host registry and tree-scoped editor composition target. */
export const inject = ['bluePluginControl', 'blueEditorHost']

function callbackMessage(error: unknown): string {
  try {
    if (typeof error !== 'object' || error === null) return 'editor provider callback failed'
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : 'editor provider callback failed'
  } catch { return 'editor provider callback failed' }
}

function desiredEditorProvider(value: unknown): string {
  if (typeof value !== 'object' || value === null) return BLUE_DEFAULT_EDITOR_PROVIDER
  const descriptor = Object.getOwnPropertyDescriptor(value, 'editorProvider')
  if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string' || descriptor.value.trim() === '') return BLUE_DEFAULT_EDITOR_PROVIDER
  return descriptor.value
}

function currentSelection(ctx: Context): string {
  const settings = ctx.get('settings') as { get(namespace: string): unknown } | undefined
  return desiredEditorProvider(settings?.get('blue'))
}

/** Attach editor.provider and publish inert candidates to the live editor tree. */
export function apply(ctx: Context): void {
  const control = ctx.bluePluginControl
  const lease = control.attachCapabilities(ctx, ['editor.provider'])
  let desiredId = currentSelection(ctx)
  let revision = -1
  let entries: readonly BlueEditorProvider[] = Object.freeze([])

  const failure = (error: unknown): BlueResult<never> => ({
    ok: false,
    code: 'BLUE_ACTION_REJECTED',
    message: callbackMessage(error),
  })
  const stale = (): BlueResult<never> => ({
    ok: false,
    code: 'BLUE_STALE',
    message: 'editor provider owner is stale',
  })

  const createBinding = (): EditorProviderBinding => Object.freeze({
    revision,
    desiredId,
    entries,
    async dispatch(provider: BlueEditorProvider, event: BlueUiEvent, signal: AbortSignal, operationRevision: number): Promise<BlueResult> {
      if (!lease.current('editor.provider')) return stale()
      if (provider.onEvent === undefined) return { ok: true, value: undefined }
      try {
        const result = await lease.runUserGesture('editor.provider', userGesture => provider.onEvent!(event, Object.freeze({
          surfaceId: provider.id,
          signal,
          revision: operationRevision,
          userGesture,
        })), signal)
        return lease.current('editor.provider') ? result : stale()
      } catch (error) { return lease.current('editor.provider') ? failure(error) : stale() }
    },
  })

  let binding = createBinding()
  const publish = (): void => {
    const next = createBinding()
    binding = next
    setEditorProviders(ctx, next)
  }

  const hostSubscription = lease.subscribe(snapshot => {
    const nextRevision = snapshot.editorProvidersRevision ?? snapshot.revision ?? 0
    if (nextRevision === revision) return
    revision = nextRevision
    entries = snapshot.editorProviders
    publish()
  })
  const select = (value: unknown): void => {
    const next = desiredEditorProvider(value)
    if (next === desiredId) return
    desiredId = next
    publish()
  }
  ctx.on('settings/updated', (namespace, next) => {
    if (String(namespace) === 'blue') select(next)
  })
  ctx.on('blue/settings-source-ready', select)
  ctx.effect(() => () => {
    hostSubscription.dispose()
    clearEditorProviders(ctx, binding)
  })
}
