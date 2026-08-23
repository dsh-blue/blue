/**
 * Renderer-neutral command projection and the sole structured-action consumer
 * for the official Harness command runtime.
 *
 * @module @dsh-blue/blue-interaction/command-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands'
import type { Action, CommandModel } from '@dsh-blue/blue-frontend'
import type {} from '@deepseek-ai/dsh-commands'

declare module '@deepseek-ai/cordis' {
  interface Context { blueCommandModels: CommandModelService }
}

/** Renderer-neutral projection of the Harness command registry. */
export class CommandModelService extends Service {
  private readonly listeners = new Set<() => void>()
  private readonly offChange: () => void
  private readonly context: Context
  private readonly active = new Set<AbortController>()
  private disposed = false
  constructor(ctx: Context) {
    super(ctx, 'blueCommandModels')
    this.context = ctx
    this.offChange = ctx.on('commands/change', () => { for (const listener of this.listeners) listener() })
    ctx.effect(() => () => this.offChange())
  }
  list(agent?: Agent): readonly CommandModel[] {
    if (agent === undefined || this.disposed) return []
    const commands = ctxCommands(this.context)
    return commands === undefined ? [] : commands.list(agent).map(toModel)
  }
  async execute(agent: Agent | undefined, action: Action, signal: AbortSignal = new AbortController().signal): Promise<CommandExecution | undefined> {
    if (agent === undefined || this.disposed || action.kind !== 'command.execute') return undefined
    const name = action.name
    const input = action.input
    if (typeof name !== 'string' || (input !== undefined && typeof input !== 'string')) return undefined
    const commands = ctxCommands(this.context)
    if (commands === undefined) return undefined
    const controller = new AbortController()
    const forward = (): void => controller.abort(signal.reason)
    signal.addEventListener('abort', forward, { once: true })
    if (signal.aborted) forward()
    this.active.add(controller)
    const separator = input === undefined || input === '' || /^\s/u.test(input) ? '' : ' '
    try {
      const execution = await commands.execute(agent, `/${name}${separator}${input ?? ''}`, [], controller.signal)
      return this.disposed ? undefined : execution
    } finally {
      signal.removeEventListener('abort', forward)
      this.active.delete(controller)
    }
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  dispose(): void { if (this.disposed) return; this.disposed = true; for (const controller of this.active) controller.abort(); this.active.clear(); this.listeners.clear(); this.offChange() }
}

function ctxCommands(ctx: Context): { list(agent: Agent): readonly CommandDescriptor[]; execute(agent: Agent, line: string, images: readonly never[], signal: AbortSignal): Promise<CommandExecution | undefined> } | undefined {
  return ctx.get('commands') as unknown as { list(agent: Agent): readonly CommandDescriptor[]; execute(agent: Agent, line: string, images: readonly never[], signal: AbortSignal): Promise<CommandExecution | undefined> } | undefined
}

function toModel(command: CommandDescriptor): CommandModel {
  return Object.freeze({ kind: 'command', id: `command.${command.name}`, label: `/${command.name}`, description: command.description, enabled: true, action: { kind: 'command.execute', name: command.name } })
}
