/**
 * Compatibility adapter from the legacy renderer-neutral frontend model to
 * canonical public Blue UI nodes. Rendering always crosses the validator and
 * sole compiler; this module owns only the temporary model-shape conversion.
 *
 * @module @dsh-blue/blue-core/frontend-renderer
 */

import type { BlueUiNode } from '@dsh-blue/blue-api'
import type { ProviderModel, View } from '@dsh-blue/blue-frontend'
import { compileBlueUiNode } from './ui-compiler.ts'
import type { BlueComponents, BlueSemanticColors } from './types.ts'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from './width.ts'

/** Optional renderer hints; colors enable semantic frontend paint. */
export interface FrontendRenderOptions {
  readonly colors?: BlueSemanticColors
  /** Internal legacy-model row budget; public surfaces keep the compiler default. */
  readonly maxRows?: number
}

const identity = (value: string): string => value
const identityColors = {
  text: identity,
  textStrong: identity,
  muted: identity,
  textMuted: identity,
  accent: identity,
  primary: identity,
  border: identity,
  borderFocus: identity,
  success: identity,
  error: identity,
  warning: identity,
  selectedBg: identity,
  roleUser: identity,
  shellMode: identity,
  mdHeading: identity,
  mdLink: identity,
  mdLinkUrl: identity,
  mdCode: identity,
  mdCodeBlock: identity,
  mdCodeBlockBorder: identity,
  mdQuote: identity,
  mdQuoteBorder: identity,
  mdHr: identity,
  mdListBullet: identity,
  diffAdded: identity,
  diffRemoved: identity,
  diffAddedStrong: identity,
  diffRemovedStrong: identity,
  diffGutter: identity,
  diffMeta: identity,
  modelHighlight: identity,
  logoGradient: [identity],
} satisfies BlueSemanticColors
const compilerComponents = { visibleWidth, wrapText: wrapTextWithAnsi, truncateToWidth } as BlueComponents

function compatibilityColors(colors: BlueSemanticColors | undefined): BlueSemanticColors {
  if (colors === undefined) return identityColors
  return {
    ...identityColors,
    diffAdded: colors.diffAdded,
    diffRemoved: colors.diffRemoved,
    diffAddedStrong: colors.diffAddedStrong,
    diffRemovedStrong: colors.diffRemovedStrong,
    diffGutter: colors.diffGutter,
    diffMeta: colors.diffMeta,
  }
}

/** A BlueComponent consumer for a readonly provider model. */
export class FrontendModelComponent {
  private model: ProviderModel
  constructor(model: ProviderModel) { this.model = model }
  setModel(model: ProviderModel): void { this.model = model }
  render(width: number): string[] { return [...renderFrontendModel(this.model, width)] }
  invalidate(): void {}
}

/**
 * Convert one legacy frontend view into the canonical public wire shape.
 * This mapping is deleted with the legacy frontend `View` contract.
 */
function toBlueUiNode(view: View): BlueUiNode {
  switch (view.kind) {
    case 'text': return { kind: 'text', content: view.text, ...(view.tone === undefined ? {} : { tone: view.tone }) }
    case 'rich-text': return { kind: 'rich-text', spans: view.spans.map(span => ({
      text: span.text,
      ...(span.tone === undefined ? {} : { tone: span.tone }),
      ...(span.strong === true ? { emphasis: 'strong' as const } : {}),
    })) }
    case 'fields': return { kind: 'fields', rows: view.fields.map(field => ({ label: field.label, value: [{ text: field.value }] })) }
    case 'sections': return { kind: 'stack', direction: 'column', children: view.sections.flatMap(section => [
      { node: { kind: 'text' as const, content: section.title } },
      ...(section.collapsed === true ? [] : [{ node: toBlueUiNode(section.body) }]),
    ]) }
    case 'list': return {
      kind: 'list',
      id: 'frontend-list',
      selectedIds: view.selectedId === undefined ? [] : [view.selectedId],
      items: view.items.map(item => ({
        id: item.id,
        label: item.label,
        ...(item.detail === undefined ? {} : { detail: item.detail }),
        ...(item.group === undefined ? {} : { group: item.group }),
        ...(item.disabled === true ? { disabled: true } : {}),
      })),
    }
    // The compatibility renderer historically omitted the language heading.
    case 'code': return { kind: 'code', code: view.code }
    case 'diff': return { kind: 'diff', before: view.before, after: view.after }
  }
}

/** Render one frontend view through the canonical compiler. */
export function renderFrontendView(view: View, width: number, opts?: FrontendRenderOptions): readonly string[] {
  const safeWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
  const result = compileBlueUiNode(toBlueUiNode(view), {
    components: compilerComponents,
    colors: compatibilityColors(opts?.colors),
    getViewport: () => ({ columns: safeWidth, rows: Number.MAX_SAFE_INTEGER }),
    screenMode: 'main',
    ...(opts?.maxRows === undefined ? {} : { maxLeafRows: opts.maxRows }),
    /* v8 ignore next -- legacy frontend views are passive */
    emit: () => {},
  })
  return result.ok ? result.value.component.render(safeWidth) : result.errorComponent.render(safeWidth)
}

/** Render the view payloads published by a frontend provider. */
export function renderFrontendModel(model: ProviderModel, width: number): readonly string[] {
  return model.views.flatMap(view => renderFrontendView(view, width))
}
