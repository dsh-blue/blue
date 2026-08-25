import type { Context } from '@deepseek-ai/cordis'
import { ActionCoordinator } from './action.ts'
import { ModelBridge } from './model.ts'
import { ProjectionBridge } from './projection.ts'
import { QuestionBridge } from './question.ts'
import { SessionBridge } from './session.ts'

type Plugin = { readonly name: string; apply(ctx: Context): void }
function provide<T extends { dispose(): void }>(name: string, value: T): Plugin { return { name, apply(ctx) { ctx.provide(name, value); ctx.effect(() => () => value.dispose()) } } }

export function sessionPlugin(adapter = new SessionBridge()): Plugin { return provide('blueHarnessSessionAdapter', adapter) }
export function projectionPlugin<S, E>(adapter: ProjectionBridge<S, E>): Plugin { return provide('blueHarnessProjectionAdapter', adapter) }
export function actionPlugin(adapter = new ActionCoordinator()): Plugin { return provide('blueHarnessActionAdapter', adapter) }
export function modelPlugin<M>(adapter: ModelBridge<M>): Plugin { return provide('blueHarnessModelAdapter', adapter) }
export function questionPlugin<Q, A>(adapter: QuestionBridge<Q, A>): Plugin { return provide('blueHarnessQuestionAdapter', adapter) }

export const name = 'blue-harness-adapter'
export const inject: readonly string[] = []
export function apply(ctx: Context): void { ctx.plugin(sessionPlugin()); ctx.plugin(actionPlugin()) }
