/**
 * Renderer-neutral command projection and the sole structured-action consumer
 * for the official Harness command runtime.
 *
 * @module @dsh-blue/blue-interaction/command-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands'
import type { Action, CommandModel } from '@dsh-blue/blue-frontend'
import type {} from '@dsh-blue/blue-app'
import { interactionTranslator, observeInteractionLocale } from './locale.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { blueCommandModels: CommandModelService }
}

/** Renderer-neutral projection of the Harness command registry. */
export class CommandModelService extends Service {
  private readonly listeners = new Set<() => void>()
  private readonly offChange: () => void
  private readonly context: Context
  private readonly active = new Set<AbortController>()
  private readonly offLocale: () => void
  private disposed = false
  constructor(ctx: Context) {
    super(ctx, 'blueCommandModels')
    this.context = ctx
    const registration = ctx.get('blueCurrentAgent')?.subscribe(() => {
      for (const listener of this.listeners) listener()
    })
    this.offChange = () => registration?.()
    ctx.effect(() => this.offChange)
    this.offLocale = observeInteractionLocale(ctx, () => {
      for (const listener of this.listeners) listener()
    })
    ctx.effect(() => this.offLocale)
  }
  list(): readonly CommandModel[] {
    if (this.disposed) return []
    const t = interactionTranslator(this.context)
    const agent = this.context.get('blueCurrentAgent')?.current()
    const commands = this.context.get('commands')
    return agent === null || agent === undefined || commands === undefined
      ? []
      : commands.list(agent).map(command => toModel(command, t))
  }
  async execute(action: Action | undefined, signal: AbortSignal = new AbortController().signal): Promise<CommandExecution | undefined> {
    if (this.disposed || action?.kind !== 'command.execute') return undefined
    const name = action.name
    const input = action.input
    if (typeof name !== 'string' || (input !== undefined && typeof input !== 'string')) return undefined
    const agent = this.context.get('blueCurrentAgent')?.current()
    const commands = this.context.get('commands')
    if (agent === null || agent === undefined || commands === undefined) return undefined
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
  dispose(): void { if (this.disposed) return; this.disposed = true; for (const controller of this.active) controller.abort(); this.active.clear(); this.listeners.clear(); this.offChange(); this.offLocale() }
}

function toModel(command: CommandDescriptor, t: (key: string) => string): CommandModel {
  return Object.freeze({
    kind: 'command',
    id: `command.${command.name}`,
    label: `/${command.name}`,
    ...(command.description === undefined ? {} : { description: t(command.description) }),
    enabled: true,
    action: { kind: 'command.execute', name: command.name },
  })
}
