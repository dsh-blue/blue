/**
 * Renderer adapter for the renderer-neutral frontend model.
 *
 * The frontend package deliberately stops at readonly views. This module is
 * the narrow TUI boundary that turns those views into terminal rows and
 * applies pi-tui's width truth before the rows reach a component or screen.
 * It knows nothing about Harness events, Agent objects, or session state.
 *
 * @module @dsh-blue/blue-core/frontend-renderer
 */

import type { ProviderModel, View } from '@dsh-blue/blue-frontend'
import { alignDiffLines, paintDiffRows, type DiffOp } from './diff-align.ts'
import { clampRowsToWidth } from './chrome.ts'
import { truncateToWidth, wrapTextWithAnsi } from './width.ts'
import type { BlueSemanticColors } from './types.ts'

/** Optional renderer hints; colors enable the diff panel's semantic paint. */
export interface FrontendRenderOptions {
  readonly colors?: BlueSemanticColors
}

/** Alignments memoized per frozen diff view object (models rebuild per projection change, renders run per frame). */
const diffAlignments = new WeakMap<object, readonly DiffOp[]>()

/** A BlueComponent consumer for a readonly provider model. */
export class FrontendModelComponent {
  private model: ProviderModel
  constructor(model: ProviderModel) { this.model = model }
  setModel(model: ProviderModel): void { this.model = model }
  render(width: number): string[] { return [...renderFrontendModel(this.model, width)] }
  invalidate(): void {}
}

/** Render one frontend view into width-bounded terminal rows. */
export function renderFrontendView(view: View, width: number, opts?: FrontendRenderOptions): readonly string[] {
  const safeWidth = Math.max(1, Math.floor(width))
  const rows = renderView(view, safeWidth, 0, opts)
  return clampRowsToWidth(rows, safeWidth, truncateToWidth)
}

/** Render the view payloads published by a frontend provider. */
export function renderFrontendModel(model: ProviderModel, width: number): readonly string[] {
  return model.views.flatMap(view => renderFrontendView(view, width))
}

function renderView(view: View, width: number, depth: number, opts?: FrontendRenderOptions): string[] {
  switch (view.kind) {
    case 'text':
      return wrapTextWithAnsi(view.text, width)
    case 'rich-text':
      return wrapTextWithAnsi(view.spans.map(span => span.text).join(''), width)
    case 'fields':
      return view.fields.map(field => truncateToWidth(`${field.label}: ${field.value}`, width))
    case 'sections': {
      const rows: string[] = []
      for (const section of view.sections) {
        const indent = '  '.repeat(depth)
        rows.push(truncateToWidth(`${indent}${section.title}`, width))
        if (section.collapsed !== true) rows.push(...renderView(section.body, width, depth + 1, opts))
      }
      return rows
    }
    case 'list': {
      return view.items.map(item => {
        const marker = item.id === view.selectedId ? '> ' : '  '
        const suffix = item.detail === undefined ? '' : ` - ${item.detail}`
        return truncateToWidth(`${marker}${item.label}${suffix}`, width)
      })
    }
    case 'code':
      return view.code.split('\n').flatMap(line => wrapTextWithAnsi(line, width))
    case 'diff': {
      let ops = diffAlignments.get(view)
      if (ops === undefined) {
        ops = alignDiffLines(view.before, view.after)
        diffAlignments.set(view, ops)
      }
      return paintDiffRows(ops, opts?.colors).flatMap(row => wrapTextWithAnsi(row, width))
    }
  }
}
