/**
 * Renderer-neutral tool presentation registry and canonical conversion from
 * the official dsh-tools presentation vocabulary.
 *
 * @module @dsh-blue/blue-transcript/tool-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { renderFrontendView, type BlueComponent, type BlueScreen } from '@dsh-blue/blue-core'
import { freezeModel, type ToolPresentationModel, type View } from '@dsh-blue/blue-frontend'

declare module '@deepseek-ai/cordis' { interface Context { blueToolModels: BlueModelToolService } }

type Source = ToolPresentationModel | (() => ToolPresentationModel | null)

/** Official facts required to build one renderer-neutral tool card. */
export interface ToolPresentationFacts {
  readonly id: string
  readonly name: string
  readonly call?: ToolCallView
  readonly result?: ToolResultView
  readonly outcome?: ToolResult
  readonly expanded?: boolean
}

/** Convert official call/result presentation metadata without reading events. */
export function createToolPresentationModel(facts: ToolPresentationFacts): ToolPresentationModel {
  const model: ToolPresentationModel = {
    kind: 'tool',
    id: facts.id,
    name: facts.name,
    call: facts.call === undefined ? { kind: 'text', text: facts.name } : toolCallView(facts.call),
    ...(facts.result === undefined && facts.outcome === undefined ? {} : { result: toolResultView(facts.result, facts.outcome, facts.name) }),
    ...(facts.expanded === undefined ? {} : { expanded: facts.expanded }),
    action: { kind: 'tool.toggle', id: facts.id },
  }
  return freezeModel(model)
}

/** Map one official pending-call view to the shared frontend vocabulary. */
export function toolCallView(view: ToolCallView): View {
  switch (view.card) {
    case 'generic': {
      const content = contentText(view.content)
      const input = view.rawInput === undefined ? undefined : readableValue(view.rawInput)
      return { kind: 'sections', sections: [{ title: view.title, body: { kind: 'text', text: content ?? input ?? '' } }] }
    }
    case 'terminal': {
      const sections: { title: string; body: View }[] = []
      if (view.description !== undefined || view.cwd !== undefined) sections.push({ title: view.description ?? 'cwd', body: { kind: 'text', text: view.cwd ?? '' } })
      sections.push({ title: 'Command', body: { kind: 'code', code: view.title, language: 'shell' } })
      return { kind: 'sections', sections }
    }
    case 'diff':
      return diffSections(view.title, view.diffs)
  }
}

/** Map one official settled-result view, or its canonical raw fallback. */
export function toolResultView(view: ToolResultView | undefined, outcome: ToolResult | undefined, name: string): View {
  const fallback = contentText(outcome?.content) ?? '(no output)'
  if (outcome?.isError === true) return { kind: 'text', text: fallback, tone: 'danger' }
  if (view === undefined) return { kind: 'text', text: fallback }
  switch (view.card) {
    case 'generic':
      return { kind: 'sections', sections: [{ title: view.title ?? name, body: { kind: 'text', text: contentText(view.content) ?? fallback } }] }
    case 'terminal': {
      const status = view.exitCode === undefined ? view.signal === undefined ? 'complete' : `signal ${view.signal}` : `exit ${String(view.exitCode)}`
      return { kind: 'sections', sections: [
        { title: view.title ?? name, body: { kind: 'code', code: view.output ?? fallback, language: 'console' } },
        { title: 'Status', body: { kind: 'text', text: status } },
      ] }
    }
    case 'diff':
      return diffSections(view.title ?? name, view.diffs)
    case 'search':
      if (view.shape === 'paths') return { kind: 'list', items: view.paths.map((path, index) => ({ id: `path-${String(index)}`, label: path })), selectedId: view.paths.length > 0 ? 'path-0' : undefined } as View
      return { kind: 'sections', sections: view.files.length === 0
        ? [{ title: view.title ?? name, body: { kind: 'text', text: '(no matches)' } }]
        : view.files.map(file => ({ title: file.path, body: { kind: 'code', code: file.matches.map(match => `${String(match.lineNumber)}: ${match.line}`).join('\n') } })) }
    case 'read':
      return { kind: 'sections', sections: [{ title: view.title ?? view.path, body: { kind: 'code', code: view.lines.map(line => `${String(line.number)}  ${line.text}`).join('\n'), ...(view.lang === undefined ? {} : { language: view.lang }) } }] }
    case 'web':
      if (view.kind === 'fetch') return { kind: 'fields', fields: [
        { label: 'url', value: view.url },
        { label: 'status', value: String(view.statusCode) },
        { label: 'truncated', value: view.truncated ? 'yes' : 'no' },
      ] }
      return { kind: 'list', items: view.sources.map((source, index) => ({ id: `source-${String(index)}`, label: source.title ?? source.url, detail: source.snippet ?? source.url })) }
  }
}

function diffSections(title: string, diffs: readonly { readonly path: string; readonly oldText: string | null; readonly newText: string }[]): View {
  return { kind: 'sections', sections: diffs.length === 0
    ? [{ title, body: { kind: 'text', text: '(no changes)' } }]
    : diffs.map(diff => ({ title: diff.path, body: { kind: 'diff', before: diff.oldText ?? '', after: diff.newText } })) }
}

function readableValue(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) ?? String(value) } catch { return String(value) }
}

function contentText(content: readonly ContentBlock[] | undefined): string | undefined {
  if (content === undefined || content.length === 0) return undefined
  return content.map((block) => {
    switch (block.type) {
      case 'text':
      case 'reasoning': return block.text
      case 'image': return '[image]'
      case 'tool-call': return `${block.name}(${block.arguments})`
      case 'tool-result': return contentText(block.content) ?? '[tool result]'
      default: return `[${String((block as { type: unknown }).type)}]`
    }
  }).join('\n')
}

class ToolModelComponent implements BlueComponent {
  private expandedOverride: boolean | undefined
  constructor(private readonly source: () => ToolPresentationModel | null) {}
  render(width: number): string[] {
    const model = this.source()
    if (model === null) return []
    const expanded = this.expandedOverride ?? model.expanded ?? false
    const view = expanded ? model.result ?? model.call : model.call
    return view === undefined ? [] : [...renderFrontendView(view, width)]
  }
  setExpanded(expanded: boolean): void { this.expandedOverride = expanded }
  invalidate(): void {}
}

/** Renderer-neutral tool presentation registry with an additive TUI bridge. */
export class BlueModelToolService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly mounted = new Map<string, () => void>()
  private screen: BlueScreen | undefined
  constructor(ctx: Context, screen?: BlueScreen) { super(ctx, 'blueToolModels'); this.screen = screen }
  attach(screen: BlueScreen): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear(); this.screen = screen; for (const id of this.models.keys()) this.mount(id) }
  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`tool model "${initial.id}" is already registered`)
    this.models.set(initial.id, source); this.mount(initial.id)
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(initial.id); this.mounted.get(initial.id)?.(); this.mounted.delete(initial.id); this.screen?.requestRender() }
  }
  refresh(id: string): void { if (this.models.has(id)) this.screen?.requestRender() }
  list(): readonly ToolPresentationModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is ToolPresentationModel => model !== null) }
  dispose(): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear(); this.models.clear(); this.screen = undefined }
  private mount(id: string): void {
    const screen = this.screen; const source = this.models.get(id)
    if (screen === undefined || source === undefined) return
    this.mounted.get(id)?.(); this.mounted.delete(id)
    /* c8 ignore next -- the closure's deleted-source branch is exercised by unload fixtures. */
    const component = new ToolModelComponent(() => { const current = this.models.get(id); return current === undefined ? null : typeof current === 'function' ? current() : current })
    this.mounted.set(id, screen.addChild(component)); screen.requestRender()
  }
}

export { ToolModelComponent }
export { BlueModelToolService as ToolModelService }
