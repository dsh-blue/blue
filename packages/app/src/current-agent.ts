/** Current raw dsh Agent selected by the Blue frontend tree.
 * @module @dsh-blue/blue-app/current-agent
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

declare module '@deepseek-ai/cordis' {
  interface Context { blueCurrentAgent: BlueCurrentAgentService }
}

/** Small selection service; Agent behavior remains on dsh's own services. */
export class BlueCurrentAgentService extends Service {
  private selected: Agent | null = null
  private currentRevision = 0
  private readonly listeners = new Set<(agent: Agent | null, revision: number) => void>()

  constructor(ctx: Context) {
    super(ctx, 'blueCurrentAgent')
    ctx.on('agent/disposed', ({ agent }) => {
      if (agent === this.selected) this.publish(null)
    })
    ctx.effect(() => () => {
      this.selected = null
      this.listeners.clear()
    })
  }

  /** Exact live Agent, or null when no Agent is selected. */
  current(): Agent | null {
    if (this.selected !== null && this.ctx.agents.get(this.selected.id) !== this.selected) this.publish(null)
    return this.selected
  }

  /** Monotonic selection revision. */
  revision(): number { return this.currentRevision }

  /** Replay and observe exact Agent selection changes. */
  subscribe(listener: (agent: Agent | null, revision: number) => void): () => void {
    this.listeners.add(listener)
    listener(this.current(), this.currentRevision)
    return this.ctx.effect(() => () => { this.listeners.delete(listener) })
  }

  /** Select one exact live registry member, or clear the selection. */
  select(agent: Agent | null): void {
    if (agent !== null && this.ctx.agents.get(agent.id) !== agent) {
      throw new Error(`cannot select non-live Agent "${String(agent.id)}"`)
    }
    this.publish(agent)
  }

  private publish(agent: Agent | null): void {
    if (agent === this.selected) return
    this.selected = agent
    this.currentRevision += 1
    for (const listener of this.listeners) listener(agent, this.currentRevision)
  }
}
