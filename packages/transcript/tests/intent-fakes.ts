/**
 * Shared fakes for the render-intent plugin specs: identity/tagged colors and
 * a structural `blueIntents` registry plus a boot helper driving one intent
 * plugin module through a real Cordis context (services via
 * `ctx.reflect.provide`, as in status-fakes).
 */

import { Context } from '@deepseek-ai/cordis'
import type { BlueSemanticColors } from '@dsh-blue/blue-core'
import type { BlueIntentEntry, BlueIntents } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Identity colors so rendered assertions see structure, not escape codes. */
const id = (text: string): string => text
export const COLORS = {
  text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
  borderFocus: id,
  success: id, error: id, warning: id, selectedBg: id, roleUser: id, shellMode: id,
  mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
  mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
  diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id,
  diffGutter: id, diffMeta: id, modelHighlight: id,
  logoGradient: [id, id, id, id, id, id, id, id, id],
}
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Tagged colors for role assertions. */
export function tagged(): BlueSemanticColors {
  const tag = (letter: string) => (text: string): string => `[${letter}]${text}[/${letter}]`
  return {
    ...COLORS,
    text: tag('T'),
    muted: tag('M'),
    textMuted: tag('TM'),
    primary: tag('P'),
    accent: tag('A'),
    shellMode: tag('SM'),
    error: tag('E'),
    warning: tag('W'),
    diffMeta: tag('DM'),
    diffAdded: tag('DA'),
    diffAddedStrong: tag('DAS'),
    diffRemoved: tag('DR'),
    diffRemovedStrong: tag('DRS'),
  }
}

/** Structural `blueIntents`: remembers entries, honors the disposer contract. */
export class FakeIntentsRegistry implements BlueIntents {
  readonly entries: BlueIntentEntry[] = []

  register(entry: BlueIntentEntry): () => void {
    this.entries.push(entry)
    let done = false
    return () => {
      if (done) return
      done = true
      const index = this.entries.indexOf(entry)
      if (index !== -1) this.entries.splice(index, 1)
    }
  }

  resolve(intent: string): BlueIntentEntry {
    const exact = this.entries.find(entry => entry.intent === intent)
    if (exact) return exact
    const generic = this.entries.find(entry => entry.intent === 'generic')
    if (generic) return generic
    const first = this.entries[0]
    if (first === undefined) throw new Error('no intent entries are registered')
    return first
  }
}

/** A plugin module shape accepted by `ctx.plugin`. */
export interface IntentPluginModule {
  name: string
  inject: string[]
  apply: (ctx: Context) => void
}

export interface IntentPluginHarness {
  ctx: Context
  registry: FakeIntentsRegistry
  entry: BlueIntentEntry
  dispose(): Promise<void>
}

/**
 * Boot one intent plugin on a fresh root context with every service it
 * injects faked.
 * @param plugin - the plugin module under test.
 */
export async function bootIntentPlugin(plugin: IntentPluginModule): Promise<IntentPluginHarness> {
  const ctx = new Context()
  const registry = new FakeIntentsRegistry()
  ctx.reflect.provide('blueIntents', registry)
  ctx.reflect.provide('blueTheme', { colors: COLORS })
  ctx.reflect.provide('blueComponents', fakeBlueComponents())
  const fiber = await ctx.plugin(plugin)
  return {
    ctx,
    registry,
    entry: registry.entries[0]!,
    dispose: () => fiber.dispose(),
  }
}
