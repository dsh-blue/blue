/**
 * Blue-owned adapter from public additive command and notification models to
 * the harness command registry and Blue's transient editor notice channel.
 * Existing command names remain protected by the registry's duplicate gate.
 *
 * @module @dsh-blue/blue-interaction/plugin-host-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { subscribeBluePluginHost, subscribeBluePluginNotifications, type BlueCommandContribution, type BluePluginHostSnapshot, type BlueResult } from '@dsh-blue/blue-api'
import { paintPluginTone, summarizePluginView } from '@dsh-blue/blue-core'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { getSharedEditor } from './editor-instance.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-interaction-bridge'

/** Owner services required before commands and notices can be projected. */
export const inject = ['bluePluginHost', 'commands', 'blueTheme']

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
  const commands = new Map<string, () => void>()

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
            return commandResult(await entry.execute(commandArgs(invocation.rawInput), {
              signal: invocation.signal,
              rawInput: invocation.rawInput,
            }))
          } catch (error) {
            return { kind: 'error', text: `plugin command failed: ${error instanceof Error ? error.message : String(error)}` }
          }
        },
      })
      commands.set(entry.id, dispose)
    }
  }

  const subscription = subscribeBluePluginHost(ctx.bluePluginHost, (snapshot: BluePluginHostSnapshot) => {
    syncCommands(snapshot.commands)
  })
  const notices = subscribeBluePluginNotifications(ctx.bluePluginHost, (notification) => {
    const text = summarizePluginView(notification.view)
    const painted = paintPluginTone(ctx.blueTheme.colors, notification.tone)(text)
    getSharedEditor()?.notice?.(painted)
  })
  ctx.effect(() => () => {
    subscription.dispose()
    notices.dispose()
    for (const dispose of commands.values()) dispose()
    commands.clear()
  })
}
