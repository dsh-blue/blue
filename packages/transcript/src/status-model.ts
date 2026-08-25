/**
 * Renderer-neutral status registry and the legacy footer consumer bridge.
 *
 * @module @dsh-blue/blue-transcript/status-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueComponents, BlueSemanticColors, BlueScreen } from '@dsh-blue/blue-core'
import type { StatusModel, Tone, View } from '@dsh-blue/blue-frontend'
import type { BlueStatus, BlueStatusEntry } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { blueStatusModels: BlueStatusModelService }
}

type Source = StatusModel | (() => StatusModel | null)

/**
 * Flatten a renderer-neutral view for the compact footer surface.
 * @param view - view to flatten.
 * @returns style-free footer text.
 */
function plainView(view: View): string {
  switch (view.kind) {
    case 'text': return view.text
    case 'rich-text': return view.spans.map(span => span.text).join('')
    case 'fields': return view.fields.map(field => `${field.label}: ${field.value}`).join('  ')
    case 'sections': return view.sections.map(section => `${section.title}: ${plainView(section.body)}`).join('  ')
    case 'list': return view.items.filter(item => !item.disabled).map(item => item.label).join(', ')
    case 'code': return view.code
    case 'diff': return view.after
  }
  /* c8 ignore next -- View is an exhaustive discriminated union. */
  return ''
}

function toneColor(tone: Tone | undefined, colors: BlueSemanticColors): (text: string) => string {
  switch (tone) {
    case 'muted': return colors.muted
    case 'accent': return colors.accent
    case 'success': return colors.success
    case 'warning': return colors.warning
    case 'danger': return colors.error
    default: return colors.text
  }
}

/** Renderer-neutral status registry with a TUI consumer bridge. */
export class BlueStatusModelService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly rendered = new Map<string, () => void>()
  private target: BlueStatus | undefined
  private screen: BlueScreen | undefined
  private colors: BlueSemanticColors | undefined
  private components: BlueComponents | undefined
  constructor(ctx: Context, screen?: BlueScreen, colors?: BlueSemanticColors, components?: BlueComponents) {
    super(ctx, 'blueStatusModels')
    this.screen = screen
    this.colors = colors
    this.components = components
  }
  attach(target: BlueStatus, screen: BlueScreen, colors: BlueSemanticColors, components: BlueComponents): void {
    for (const dispose of this.rendered.values()) dispose()
    this.rendered.clear()
    this.target = target; this.screen = screen; this.colors = colors
    this.components = components
    for (const id of this.models.keys()) this.render(id)
  }
  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`status model "${initial.id}" is already registered`)
    this.models.set(initial.id, source); this.render(initial.id)
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(initial.id); this.rendered.get(initial.id)?.(); this.rendered.delete(initial.id); this.screen?.requestRender() }
  }
  refresh(id: string): void { if (!this.models.has(id)) return; this.render(id) }
  list(): readonly StatusModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is StatusModel => model !== null) }
  dispose(): void { for (const dispose of this.rendered.values()) dispose(); this.rendered.clear(); this.models.clear(); this.target = undefined }
  private render(id: string): void {
    const target = this.target; const colors = this.colors; const components = this.components; const source = this.models.get(id)
    if (target === undefined || colors === undefined || components === undefined || source === undefined) return
    const previous = this.rendered.get(id)
    previous?.(); this.rendered.delete(id)
    const model = typeof source === 'function' ? source() : source
    if (model === null || !model.visible) {
      if (previous !== undefined) this.screen?.requestRender()
      return
    }
    const entry: BlueStatusEntry = {
      id: model.id,
      priority: model.priority ?? 0,
      align: model.band === 'right' ? 'right' : 'left',
      ...(model.row === undefined ? {} : { row: model.row }),
      render: width => {
        if (width <= 0) return ''
        const current = typeof source === 'function' ? source() : source
        if (current === null || !current.visible) return ''
        const paint = toneColor(current.view.kind === 'text' ? current.view.tone : undefined, colors)
        const text = plainView(current.view)
        if (current.overflow === 'hide' && components.visibleWidth(text) > width) return ''
        return paint(components.truncateToWidth(text, width))
      },
    }
    this.rendered.set(id, target.register(entry))
    this.screen?.requestRender()
  }
}

export { plainView }
