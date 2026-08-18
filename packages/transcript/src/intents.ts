/**
 * `ctx.blueIntents` service: the render-intent registry behind tool-card
 * creation. Tool items carry a resolved `view` whose `card` tag selects an
 * intent; the mounter resolves it through this registry and lets the entry
 * create the component, so specialized cards (terminal, diff, …) ship as
 * ordinary plugin contributions over the built-in `'generic'` baseline.
 * Resolution never throws for an unknown intent: exact match, then the
 * `'generic'` entry, then the first registered entry — the same
 * default-ignore philosophy as the fold.
 *
 * @module @deepseek-ai/dsh-blue-transcript/intents
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueIntentEntry, BlueIntents } from './types.ts'

/** Stable error taxonomy for intent-registry failures. */
export class BlueIntentsError extends Error {
  /** Machine-readable failure kind. */
  readonly code: 'DUPLICATE_INTENT' | 'NO_INTENTS'

  /**
   * @param message - the conflicting intent or the empty-registry report.
   * @param code - the failure kind.
   */
  constructor(message: string, code: 'DUPLICATE_INTENT' | 'NO_INTENTS') {
    super(message)
    this.name = 'BlueIntentsError'
    this.code = code
  }
}

/** A registry record: the entry plus its registration-order tiebreak. */
interface RegisteredEntry {
  entry: BlueIntentEntry
  seq: number
}

/**
 * The `blueIntents` service. Instantiated directly in the transcript plugin's
 * `apply` (the built-in `'generic'` entry closes over `ToolCallComponent`,
 * so a class plugin cannot register it before the service exists);
 * registration is still effect-bound through the `Service` base, so unloading
 * the fiber unregisters the service.
 */
export class BlueIntentsService extends Service implements BlueIntents {
  private readonly entries = new Map<string, RegisteredEntry>()
  private nextSeq = 0

  /**
   * Create and register the service.
   * @param ctx - the owning Cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'blueIntents')
  }

  /**
   * Register one entry.
   * @param entry - the entry to add; its intent must be unclaimed.
   * @returns a disposer unregistering the entry; safe to call twice.
   */
  register(entry: BlueIntentEntry): () => void {
    if (this.entries.has(entry.intent)) {
      throw new BlueIntentsError(`intent "${entry.intent}" is already registered`, 'DUPLICATE_INTENT')
    }
    this.entries.set(entry.intent, { entry, seq: this.nextSeq })
    this.nextSeq += 1
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.entries.delete(entry.intent)
    }
  }

  /**
   * Resolve the entry for one intent: exact match, else `'generic'`, else the
   * first registered entry. Unknown intents fall back rather than throw.
   * @param intent - the intent name (a view's `card` tag).
   * @returns the resolved entry.
   */
  resolve(intent: string): BlueIntentEntry {
    const exact = this.entries.get(intent)
    if (exact) return exact.entry
    const generic = this.entries.get('generic')
    if (generic) return generic.entry
    let first: RegisteredEntry | undefined
    for (const record of this.entries.values()) {
      if (first === undefined || record.seq < first.seq) first = record
    }
    if (first === undefined) {
      throw new BlueIntentsError('no intent entries are registered', 'NO_INTENTS')
    }
    return first.entry
  }
}
