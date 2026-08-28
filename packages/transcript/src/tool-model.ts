/**
 * Renderer-neutral tool presentation registry and canonical conversion from
 * the official dsh-tools presentation vocabulary.
 *
 * @module @dsh-blue/blue-transcript/tool-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { diffChangeCounts, renderFrontendView, type BlueComponent, type BlueScreen, type BlueSemanticColors } from '@dsh-blue/blue-core'
import { freezeModel, type ToolPresentationModel, type View } from '@dsh-blue/blue-frontend'
import { summarizeToolText } from './envelope.ts'
import { summarizeToolCall } from './present.ts'

declare module '@deepseek-ai/cordis' { interface Context { blueToolModels: BlueModelToolService } }

type Source = ToolPresentationModel | (() => ToolPresentationModel | null)

const COLLAPSED_ROW_LIMIT = 12
const EXPANDED_ROW_LIMIT = 200

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
  const fallback = summarizeToolText(contentText(outcome?.content) ?? '(no output)')
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
    case 'search': {
      // The compact registry shape: counts, never the match corpus — the
      // transcript's grouped card renders from the group model instead.
      if (view.shape === 'paths') {
        const count = view.total
        return { kind: 'fields', fields: [{ label: 'paths', value: count === view.paths.length ? String(count) : `${String(view.paths.length)} of ${String(count)}` }] }
      }
      const kept = view.files.reduce((sum, file) => sum + file.matches.length, 0)
      const matches = view.truncated && view.total !== kept ? `${String(kept)} of ${String(view.total)}` : String(kept)
      return { kind: 'fields', fields: [
        { label: 'files', value: String(view.files.length) },
        { label: 'matches', value: matches },
      ] }
    }
    case 'read': {
      // The compact registry shape: the window facts, never the content —
      // the transcript's grouped card renders from the group model instead.
      const first = view.lines[0]?.number
      const last = view.lines.at(-1)?.number
      const window = first === undefined || last === undefined
        ? `from line ${String(view.offset)}`
        : `${String(first)}-${String(last)}`
      const open = view.totalLines > (last ?? view.offset - 1) ? ` of ${String(view.totalLines)}` : ''
      return { kind: 'fields', fields: [
        { label: 'path', value: view.path },
        { label: 'lines', value: `${window}${String(open)}` },
      ] }
    }
    case 'web':
      if (view.kind === 'fetch') return { kind: 'fields', fields: [
        { label: 'url', value: view.url },
        { label: 'status', value: String(view.statusCode) },
        { label: 'truncated', value: view.truncated ? 'yes' : 'no' },
      ] }
      return { kind: 'list', items: view.sources.map((source, index) => ({ id: `source-${String(index)}`, label: source.title ?? source.url, detail: source.snippet ?? source.url })) }
  }
}

/** One file section title: change counts, or the new-file shape for a create. */
function diffSectionTitle(diff: { readonly path: string; readonly oldText: string | null; readonly newText: string }): string {
  if (diff.oldText === null) {
    const { added } = diffChangeCounts('', diff.newText)
    return `${diff.path} · new file, +${String(added)} lines`
  }
  const { added, removed } = diffChangeCounts(diff.oldText, diff.newText)
  return `${diff.path} · +${String(added)} −${String(removed)}`
}

function diffSections(title: string, diffs: readonly { readonly path: string; readonly oldText: string | null; readonly newText: string }[]): View {
  return { kind: 'sections', sections: diffs.length === 0
    ? [{ title, body: { kind: 'text', text: '(no changes)' } }]
    : diffs.map(diff => ({ title: diffSectionTitle(diff), body: { kind: 'diff', before: diff.oldText ?? '', after: diff.newText } })) }
}

/**
 * The semantic result chip for a tool card's header: summed `+A −D` when the
 * presentation's result is diff-shaped, or `undefined` to keep the plain line
 * count (the raw-result line count misleads on envelope-backed results).
 * @param presentation - the tool's presentation model, if any.
 * @returns the chip text, or `undefined` when no diff view contributes.
 */
export function toolResultChip(presentation: ToolPresentationModel | undefined): string | undefined {
  if (presentation === undefined) return undefined
  let added = 0
  let removed = 0
  const walk = (view: View | undefined): void => {
    if (view === undefined) return
    if (view.kind === 'diff') {
      const counts = diffChangeCounts(view.before, view.after)
      added += counts.added
      removed += counts.removed
      return
    }
    if (view.kind === 'sections') for (const section of view.sections) walk(section.body)
  }
  walk(presentation.result)
  if (added === 0 && removed === 0) return undefined
  return `+${String(added)} −${String(removed)}`
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
      case 'tool-call': return summarizeToolCall(block.name, block.arguments)
      case 'tool-result': return contentText(block.content) ?? '[tool result]'
      default: return `[${String((block as { type: unknown }).type)}]`
    }
  }).join('\n')
}

class ToolModelComponent implements BlueComponent {
  private expandedOverride: boolean | undefined
  constructor(
    private readonly source: () => ToolPresentationModel | null,
    private readonly colors?: BlueSemanticColors,
  ) {}
  render(width: number): string[] {
    const model = this.source()
    if (model === null) return []
    const expanded = this.expandedOverride ?? model.expanded ?? false
    const view = expanded ? model.result ?? model.call : model.call
    if (view === undefined) return []
    const renderOptions = {
      // The tool component applies its own 12/200-row budget and needs the
      // complete validated row count to report the exact hidden remainder.
      maxRows: Number.MAX_SAFE_INTEGER,
      ...(this.colors === undefined ? {} : { colors: this.colors }),
    }
    const rows = [...renderFrontendView(view, width, renderOptions)]
    const limit = expanded ? EXPANDED_ROW_LIMIT : COLLAPSED_ROW_LIMIT
    if (rows.length <= limit) return rows
    const remaining = rows.length - limit + 1
    const hint = expanded
      ? `... (${String(remaining)} more lines)`
      : `... (${String(remaining)} more lines, ctrl+o to expand)`
    const hintRow = renderFrontendView({ kind: 'text', text: hint }, width)[0]!
    return [...rows.slice(0, limit - 1), hintRow]
  }
  setExpanded(expanded: boolean): void { this.expandedOverride = expanded }
  invalidate(): void {}
}

/** Renderer-neutral tool presentation registry with an additive TUI bridge. */
export class BlueModelToolService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly mounted = new Map<string, () => void>()
  private screen: BlueScreen | undefined
  constructor(ctx: Context, screen?: BlueScreen, private readonly colors?: BlueSemanticColors) { super(ctx, 'blueToolModels'); this.screen = screen }
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
    const component = new ToolModelComponent(() => { const current = this.models.get(id); return current === undefined ? null : typeof current === 'function' ? current() : current }, this.colors)
    this.mounted.set(id, screen.addChild(component)); screen.requestRender()
  }
}

export { ToolModelComponent }
export { BlueModelToolService as ToolModelService }
