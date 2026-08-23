import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands'
import type { CommandModel } from '@dsh-blue/blue-frontend'
import type {} from '@deepseek-ai/dsh-commands'

declare module '@deepseek-ai/cordis' {
  interface Context { blueCommandModels: CommandModelService }
}

/** Renderer-neutral projection of the Harness command registry. */
export class CommandModelService extends Service {
  private readonly listeners = new Set<() => void>()
  private readonly offChange: () => void
  private readonly context: Context
  constructor(ctx: Context) {
    super(ctx, 'blueCommandModels')
    this.context = ctx
    this.offChange = ctx.on('commands/change', () => { for (const listener of this.listeners) listener() })
    ctx.effect(() => () => this.offChange())
  }
  list(agent?: Agent): readonly CommandModel[] {
    if (agent === undefined) return []
    const commands = ctxCommands(this.context)
    return commands === undefined ? [] : commands.list(agent).map(toModel)
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  dispose(): void { this.listeners.clear(); this.offChange() }
}

function ctxCommands(ctx: Context): { list(agent: Agent): readonly CommandDescriptor[] } | undefined {
  return ctx.get('commands') as unknown as { list(agent: Agent): readonly CommandDescriptor[] } | undefined
}

function toModel(command: CommandDescriptor): CommandModel {
  return Object.freeze({ kind: 'command', id: `command.${command.name}`, label: `/${command.name}`, description: command.description, enabled: true, action: { kind: 'command.execute', name: command.name } })
}
