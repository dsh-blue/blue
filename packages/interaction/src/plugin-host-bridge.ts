/**
 * Blue-owned adapter from public additive command and notification models to
 * the harness command registry and Blue's transient editor notice channel.
 * Existing command names remain protected by the registry's duplicate gate.
 *
 * @module @dsh-blue/blue-interaction/plugin-host-bridge
 */

import { symbols, type Context } from '@deepseek-ai/cordis'
import {
  attachBluePluginHostCapabilities,
  runBlueUserGesture,
  subscribeBluePluginHost,
  subscribeBluePluginNotifications,
  type BlueCommandContribution,
  type BlueEditorCompletionItem,
  type BlueEditorExtensionContribution,
  type BlueEditorSubmitValue,
  type BluePluginHostSnapshot,
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
export const inject = ['bluePluginHost', 'commands', 'blueTheme', 'blueEditorHost']

function callbackMessage(error: unknown): string {
  try {
    if (typeof error !== 'object' || error === null) return 'editor extension callback failed'
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : 'editor extension callback failed'
  } catch { return 'editor extension callback failed' }
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
  const host = (ctx.bluePluginHost as unknown as Record<symbol, typeof ctx.bluePluginHost | undefined>)[symbols.original] ?? ctx.bluePluginHost
  attachBluePluginHostCapabilities(host, ctx, ['commands', 'notifications', 'editor.extensions'])
  const commands = new Map<string, () => void>()
  let extensionsRevision = -1

  const callbackFailure = (error: unknown): BlueResult<never> => ({
    ok: false,
    code: 'BLUE_ACTION_REJECTED',
    message: callbackMessage(error),
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
      try {
        const context = Object.freeze({ surfaceId: entry.id, signal, revision: operationRevision })
        if (entry.completeV2 !== undefined) return await entry.completeV2(request, context)
        if (request.trigger === '#' || entry.complete === undefined) return { ok: true, value: [] }
        return await entry.complete(Object.freeze({ query: request.query, trigger: request.trigger }), context)
      } catch (error) { return callbackFailure(error) }
    },
    async transform(
      entry: BlueEditorExtensionContribution,
      request: Parameters<NonNullable<BlueEditorExtensionContribution['transformSubmit']>>[0],
      signal: AbortSignal,
      operationRevision: number,
    ): Promise<BlueResult<BlueEditorSubmitValue>> {
      if (entry.transformSubmit === undefined) return { ok: true, value: { text: request.text } }
      try {
        return await entry.transformSubmit(request, Object.freeze({ surfaceId: entry.id, signal, revision: operationRevision }))
      } catch (error) { return callbackFailure(error) }
    },
    async dispatch(
      entry: BlueEditorExtensionContribution,
      event: Parameters<NonNullable<BlueEditorExtensionContribution['onEvent']>>[0],
      signal: AbortSignal,
      operationRevision: number,
    ): Promise<BlueResult> {
      if (entry.onEvent === undefined) return { ok: true, value: undefined }
      try {
        return await runBlueUserGesture(host, ctx, userGesture => entry.onEvent!(event, Object.freeze({
          surfaceId: entry.id,
          signal,
          revision: operationRevision,
          userGesture,
        })), signal)
      } catch (error) { return callbackFailure(error) }
    },
  })
  let binding = extensionBinding([], extensionsRevision)

  const syncCommands = (entries: readonly BlueCommandContribution[]): void => {
    const live = new Set(entries.map(entry => entry.id))
    for (const [id, dispose] of commands) {
      if (live.has(id)) continue
      dispose()
      commands.delete(id)
    }
    for (const entry of entries) {
      if (commands.has(entry.id)) continue
      const dispose = ctx.commands.register({
        name: entry.id,
        description: entry.label,
        handler: async (invocation) => {
          try {
            return commandResult(await runBlueUserGesture(host, ctx, userGesture => entry.execute(commandArgs(invocation.rawInput), {
              signal: invocation.signal,
              rawInput: invocation.rawInput,
              userGesture,
            }), invocation.signal))
          } catch (error) {
            return { kind: 'error', text: `plugin command failed: ${error instanceof Error ? error.message : String(error)}` }
          }
        },
      })
      commands.set(entry.id, dispose)
    }
  }

  const subscription = subscribeBluePluginHost(host, (snapshot: BluePluginHostSnapshot) => {
    syncCommands(snapshot.commands)
    const revision = snapshot.editorExtensionsRevision!
    if (revision !== extensionsRevision) {
      extensionsRevision = revision
      const next = extensionBinding(snapshot.editorExtensions, revision)
      binding = next
      setEditorExtensions(ctx, next)
    }
  })
  const notices = subscribeBluePluginNotifications(host, (notification) => {
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
