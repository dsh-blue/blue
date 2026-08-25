/**
 * Cordis composition for the context feature and its official projection
 * adapter. The root plugin stays inert on hosts without the optional services.
 *
 * @module @dsh-blue/blue-context/plugins
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import { ContextFeature } from './feature.ts'
import { OfficialContextSource, type OfficialSessionProjectionService } from './official-source.ts'

export interface ContextPlugin extends Plugin.Object<void> { readonly name: string; readonly inject?: string[]; apply(ctx: Context): void }
export function contextPlugin(feature = new ContextFeature()): ContextPlugin { return { name: 'blue-context-feature', apply(ctx) { ctx.provide('blueContextFeature', feature); ctx.effect(() => () => feature.dispose()) } } }

interface SessionRef {
  readonly current: unknown | null
}

function sessionOf(agent: unknown): unknown | undefined {
  return (agent as { readonly session?: unknown }).session
}

function sessionIdOf(agent: unknown): string | undefined {
  if (agent === null || typeof agent !== 'object') return undefined
  const row = agent as { readonly id?: unknown; readonly session?: { readonly id?: unknown; readonly header?: { readonly id?: unknown } } }
  const id = row.id ?? row.session?.id ?? row.session?.header?.id
  return typeof id === 'string' ? id : undefined
}

/** Build the official current-session adapter plugin. */
export function officialContextPlugin(): ContextPlugin {
  return {
    name: 'blue-context-official',
    inject: ['sessionProjections', 'blueSession'],
    apply(ctx) {
      const projections = ctx.get('sessionProjections') as unknown as OfficialSessionProjectionService
      const sessions = ctx.get('blueSession') as unknown as SessionRef
      const source = new OfficialContextSource(projections, sessionId => {
        const current = sessions.current
        return sessionIdOf(current) === sessionId ? sessionOf(current) : undefined
      })
      const feature = new ContextFeature(source)
      contextPlugin(feature).apply(ctx)
      const attach = (agent: unknown): void => {
        const sessionId = sessionIdOf(agent)
        if (sessionId === undefined) feature.detach()
        else void feature.attach(sessionId)
      }
      const events = ctx as unknown as { on(event: string, listener: (agent: unknown) => void): () => void }
      events.on('blue/session-changed', attach)
      if (sessions.current !== null) attach(sessions.current)
    },
  }
}

export const name = 'blue-context'
export const inject: readonly string[] = []
export function apply(ctx: Context): void { ctx.plugin(officialContextPlugin()) }
