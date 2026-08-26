/**
 * Renderer-neutral status registry and footer consumer.
 *
 * @module @dsh-blue/blue-transcript/status-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueComponents, BlueSemanticColors, BlueScreen } from '@dsh-blue/blue-core'
import type { StatusModel, Tone, View } from '@dsh-blue/blue-frontend'

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
  constructor(ctx: Context, private screen?: BlueScreen) {
    super(ctx, 'blueStatusModels')
  }
  attach(screen: BlueScreen): void {
    this.screen = screen
    screen.requestRender()
  }
  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`status model "${initial.id}" is already registered`)
    this.models.set(initial.id, source)
    this.screen?.requestRender()
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(initial.id); this.screen?.requestRender() }
  }
  refresh(id: string): void { if (this.models.has(id)) this.screen?.requestRender() }
  list(): readonly StatusModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is StatusModel => model !== null) }
  dispose(): void { this.models.clear(); this.screen?.requestRender(); this.screen = undefined }
}

/**
 * Renderer-owned footer for the renderer-neutral status registry.
 *
 * The component reads the current model snapshot on every frame.
 */
export class StatusModelFooterComponent implements BlueComponent {
  private cache: { key: string, lines: string[] } | null = null

  constructor(
    private readonly models: BlueStatusModelService,
    private readonly components: BlueComponents,
    private readonly colors: BlueSemanticColors,
  ) {}

  invalidate(): void { this.cache = null }

  render(width: number): string[] {
    const visible = this.models.list().filter(model => model.visible)
    const bands: { left: StatusModel[], right: StatusModel[] }[] = [{ left: [], right: [] }, { left: [], right: [] }]
    for (const model of visible) {
      const band = Math.min(2, Math.max(1, model.row ?? 1)) - 1
      bands[band]![model.band === 'right' ? 'right' : 'left'].push(model)
    }
    const lines: string[] = []
    const keys: string[] = []
    for (const band of bands) {
      const leftText = this.renderCluster(band.left, width)
      const leftWidth = this.components.visibleWidth(leftText)
      const rightBudget = band.right.length === 0 ? 0 : Math.max(0, width - leftWidth - (leftText === '' ? 0 : 2))
      const rightText = rightBudget > 0 ? this.renderCluster(band.right, rightBudget) : ''
      if (leftText === '' && rightText === '') continue
      const rightWidth = this.components.visibleWidth(rightText)
      const line = leftText === ''
        ? ' '.repeat(Math.max(0, width - rightWidth)) + rightText
        : rightText === ''
          ? leftText + ' '.repeat(Math.max(0, width - leftWidth))
          : leftText + ' '.repeat(Math.max(0, width - leftWidth - rightWidth)) + rightText
      lines.push(line)
      keys.push(`${leftText}\x00${rightText}`)
    }
    const key = `${width}:${keys.join('\x01')}`
    if (this.cache?.key === key) return this.cache.lines
    this.cache = { key, lines }
    return lines
  }

  private renderCluster(models: readonly StatusModel[], width: number): string {
    if (width <= 0) return ''
    const parts: string[] = []
    let used = 0
    for (const model of models) {
      const remaining = width - used - (parts.length > 0 ? 2 : 0)
      if (remaining <= 0) break
      const text = plainView(model.view)
      if (text === '' || (model.overflow === 'hide' && this.components.visibleWidth(text) > remaining)) continue
      const part = this.paint(model.view.kind === 'text' ? model.view.tone : undefined, this.components.truncateToWidth(text, remaining))
      /* c8 ignore next -- renderer width helpers never return an empty paint for non-empty input. */
      if (part === '') continue
      const partWidth = this.components.visibleWidth(part)
      /* c8 ignore next -- the core truncation seam guarantees this invariant. */
      if (partWidth > remaining) continue
      parts.push(part)
      used += (parts.length > 1 ? 2 : 0) + partWidth
    }
    return parts.join('  ')
  }

  private paint(tone: Tone | undefined, text: string): string {
    return toneColor(tone, this.colors)(text)
  }
}

export { plainView }
