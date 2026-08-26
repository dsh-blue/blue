/**
 * Cordis composition for the context feature and its official projection
 * adapter. The root plugin stays inert on hosts without the optional services.
 *
 * @module @dsh-blue/blue-context/plugins
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
// Load blue-app's Context service declarations for the renderer-neutral seams.
import type {} from '@dsh-blue/blue-app'
import { ContextFeature } from './feature.ts'
import { OfficialContextSource } from './official-source.ts'

export interface ContextPlugin extends Plugin.Object<void> { readonly name: string; readonly inject?: string[]; apply(ctx: Context): void }
export function contextPlugin(feature = new ContextFeature()): ContextPlugin { return { name: 'blue-context-feature', apply(ctx) { ctx.provide('blueContextFeature', feature); ctx.effect(() => () => feature.dispose()) } } }

/** Build the official current-session adapter plugin. */
export function officialContextPlugin(): ContextPlugin {
  return {
    name: 'blue-context-official',
    inject: ['blueSessionProjections', 'blueSessionReader'],
    apply(ctx) {
      const source = new OfficialContextSource(ctx.blueSessionProjections, () => ctx.blueSessionReader.current()?.id)
      const feature = new ContextFeature(source)
      contextPlugin(feature).apply(ctx)
      const registration = ctx.blueSessionReader.subscribe(session => {
        if (session === null) feature.detach()
        else void feature.attach(session.id)
      })
      ctx.effect(() => () => {
        registration.dispose()
      })
    },
  }
}

export const name = 'blue-context'
export const inject: readonly string[] = []
export function apply(ctx: Context): void { ctx.plugin(officialContextPlugin()) }
