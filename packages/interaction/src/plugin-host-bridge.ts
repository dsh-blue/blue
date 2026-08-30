/**
 * Blue-owned adapter from public additive command and notification models to
 * the harness command registry and Blue's transient editor notice channel.
 * Existing command names remain protected by the registry's duplicate gate.
 *
 * @module @dsh-blue/blue-interaction/plugin-host-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  type BlueCommandContribution,
  type BlueEditorCompletionItem,
  type BlueEditorExtensionContribution,
  type BlueEditorSubmitValue,
  type BlueResult,
} from '@dsh-blue/blue-api'
import { paintPluginTone, summarizePluginView } from '@dsh-blue/blue-core'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import {
  clearEditorExtensions,
  getSharedEditor,
  setEditorExtensions,
  type EditorExtensionBinding,
} from './editor-instance.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-interaction-bridge'

/** Owner services required before commands and notices can be projected. */
export const inject = ['bluePluginControl', 'commands', 'blueTheme', 'blueEditorHost']

function callbackMessage(error: unknown): string {
  try {
    if (typeof error !== 'object' || error === null) return 'editor extension callback failed'
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : 'editor extension callback failed'
  } catch { return 'editor extension callback failed' }
}

function commandCallbackMessage(error: unknown): string {
  try {
    if (typeof error !== 'object' || error === null) return 'plugin command callback failed'
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : 'plugin command callback failed'
  } catch { return 'plugin command callback failed' }
}

function commandResult(result: BlueResult): CommandResult {
  if (result.ok) return { kind: 'success' }
  return { kind: 'error', text: result.message.trim() || result.code }
}

function commandArgs(rawInput: string): readonly string[] {
  const value = rawInput.trim()
  return value.length === 0 ? [] : value.split(/\s+/u)
}

/** Register public commands and route public notifications without exposing owner services. */
export function apply(ctx: Context): void {
  const control = ctx.bluePluginControl
  const lease = control.attachCapabilities(ctx, ['commands', 'notifications.publish', 'editor.extensions'])
  const commands = new Map<string, () => void>()
  let extensionsRevision = -1

  const callbackFailure = (error: unknown): BlueResult<never> => ({
    ok: false,
    code: 'BLUE_ACTION_REJECTED',
    message: callbackMessage(error),
  })
  const staleExtension = (): BlueResult<never> => ({
    ok: false,
    code: 'BLUE_STALE',
    message: 'editor extension owner is stale',
  })

  const extensionBinding = (entries: readonly BlueEditorExtensionContribution[], revision: number): EditorExtensionBinding => Object.freeze({
    revision,
    entries,
    async complete(
      entry: BlueEditorExtensionContribution,
    request: Parameters<NonNullable<BlueEditorExtensionContribution['completeV2']>>[0],
      signal: AbortSignal,
      operationRevision: number,
    ): Promise<BlueResult<readonly BlueEditorCompletionItem[]>> {
      if (!lease.current('editor.extensions')) return staleExtension()
      try {
        const context = Object.freeze({ surfaceId: entry.id, signal, revision: operationRevision })
        if (entry.completeV2 !== undefined) {
          const result = await entry.completeV2(request, context)
          return lease.current('editor.extensions') ? result : staleExtension()
        }
        if (request.trigger === '#' || entry.complete === undefined) return { ok: true, value: [] }
        const result = await entry.complete(Object.freeze({ query: request.query, trigger: request.trigger }), context)
        return lease.current('editor.extensions') ? result : staleExtension()
      } catch (error) { return lease.current('editor.extensions') ? callbackFailure(error) : staleExtension() }
    },
    async transform(
      entry: BlueEditorExtensionContribution,
      request: Parameters<NonNullable<BlueEditorExtensionContribution['transformSubmit']>>[0],
      signal: AbortSignal,
      operationRevision: number,
    ): Promise<BlueResult<BlueEditorSubmitValue>> {
      if (!lease.current('editor.extensions')) return staleExtension()
      if (entry.transformSubmit === undefined) return { ok: true, value: { text: request.text } }
      try {
        const result = await entry.transformSubmit(request, Object.freeze({ surfaceId: entry.id, signal, revision: operationRevision }))
        return lease.current('editor.extensions') ? result : staleExtension()
      } catch (error) { return lease.current('editor.extensions') ? callbackFailure(error) : staleExtension() }
    },
    async dispatch(
      entry: BlueEditorExtensionContribution,
      event: Parameters<NonNullable<BlueEditorExtensionContribution['onEvent']>>[0],
      signal: AbortSignal,
      operationRevision: number,
    ): Promise<BlueResult> {
      if (!lease.current('editor.extensions')) return staleExtension()
      if (entry.onEvent === undefined) return { ok: true, value: undefined }
      try {
        const result = await lease.runUserGesture('editor.extensions', userGesture => entry.onEvent!(event, Object.freeze({
          surfaceId: entry.id,
          signal,
          revision: operationRevision,
          userGesture,
        })), signal)
        return lease.current('editor.extensions') ? result : staleExtension()
      } catch (error) { return lease.current('editor.extensions') ? callbackFailure(error) : staleExtension() }
    },
  })
  let binding = extensionBinding([], extensionsRevision)

  const syncCommands = (entries: readonly BlueCommandContribution[]): void => {
    const liveIds = new Set(entries.map(entry => entry.id))
    for (const [id, dispose] of commands) {
      if (liveIds.has(id)) continue
      dispose()
      commands.delete(id)
    }
    for (const entry of entries) {
      if (commands.has(entry.id)) continue
      let adapterLive = true
      const stale = () => !adapterLive || !lease.current('commands')
      const unregister = ctx.commands.register({
        name: entry.id,
        description: entry.label,
        handler: async (invocation) => {
          if (stale()) return { kind: 'error', text: 'plugin command result is stale' }
          try {
            const result = await lease.runUserGesture('commands', userGesture => entry.execute(commandArgs(invocation.rawInput), {
              signal: invocation.signal,
              rawInput: invocation.rawInput,
              userGesture,
            }), invocation.signal)
            if (stale()) return { kind: 'error', text: 'plugin command result is stale' }
            return commandResult(result)
          } catch (error) {
            if (stale()) return { kind: 'error', text: 'plugin command result is stale' }
            return { kind: 'error', text: `plugin command failed: ${commandCallbackMessage(error)}` }
          }
        },
      })
      commands.set(entry.id, () => { adapterLive = false; unregister() })
    }
  }

  const subscription = lease.subscribe((snapshot) => {
    syncCommands(snapshot.commands)
    const revision = snapshot.editorExtensionsRevision!
    if (revision !== extensionsRevision) {
      extensionsRevision = revision
      const next = extensionBinding(snapshot.editorExtensions, revision)
      binding = next
      setEditorExtensions(ctx, next)
    }
  })
  const notices = lease.observeNotifications((notification) => {
    const text = summarizePluginView(notification.view)
    const painted = paintPluginTone(ctx.blueTheme.colors, notification.tone)(text)
    getSharedEditor(ctx)?.notice?.(painted)
  })
  ctx.effect(() => () => {
    subscription.dispose()
    notices.dispose()
    clearEditorExtensions(ctx, binding)
    for (const dispose of commands.values()) dispose()
    commands.clear()
  })
}
