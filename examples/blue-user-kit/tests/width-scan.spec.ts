/**
 * Canonical compiler width scans for the shared kit and all six examples.
 *
 * @module @dsh-blue-example/user-kit/tests/width-scan
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  BluePluginHostService,
  type BlueEditorSnapshot,
  type BlueStatusSnapshot,
  type BlueUiNode,
} from '../../../packages/api/src/index.ts'
import { BlueComponentsService } from '../../../packages/core/src/components.ts'
import { DARK_COLORS } from '../../../packages/core/src/theme-dark.ts'
import { compileBlueEditorShellNode, compileBlueStatusNode, compileBlueUiNode } from '../../../packages/core/src/ui-compiler.ts'
import { createFakeEditor } from '../../../packages/core/tests/fake-editor.ts'
import { ADVERSARIAL, expectLinesFit, SCAN_WIDTHS } from '../../../packages/core/tests/width-scan.ts'
import { ui } from '../../../packages/ui/src/index.ts'
import { apply as applyBottomLog } from '../../bottom-log/src/index.ts'
import { editorProvider } from '../../editor-provider/src/index.ts'
import { apply as applyHeader } from '../../header/src/index.ts'
import { overlayRequest } from '../../overlay/src/index.ts'
import { apply as applyInspector } from '../../right-inspector/src/index.ts'
import { statusProvider } from '../../status-provider/src/index.ts'
import { summaryMetric } from '../src/index.ts'

class Scope {
  readonly bluePluginHost: BluePluginHostService
  private readonly cleanups: (() => void)[] = []
  constructor(host: BluePluginHostService) { this.bluePluginHost = host }
  effect(callback: () => () => void): void { this.cleanups.push(callback()) }
  dispose(): void { for (const cleanup of this.cleanups.splice(0).reverse()) cleanup() }
}

const components = new BlueComponentsService(new Context(), { theme: { colors: DARK_COLORS }, tui: {} as never })

function uiRows(name: string, node: BlueUiNode): void {
  const viewport = { columns: 120, rows: 20 }
  const result = compileBlueUiNode(node, {
    components, colors: DARK_COLORS, getViewport: () => viewport, screenMode: 'alternate', emit: () => {},
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  for (const width of SCAN_WIDTHS) {
    viewport.columns = width
    expectLinesFit(name, result.value.component.render(width), width)
  }
}

describe('example width contracts', () => {
  it('scans every pane and the overlay through the canonical compiler', () => {
    const hostContext = new Context()
    const host = new BluePluginHostService(hostContext)
    const control = hostContext.get('bluePluginControl')!
    const owner = new Scope(host)
    const consumer = new Scope(host)
    control.attachCapabilities(owner, ['panes'])
    const ctx = consumer as unknown as Context
    applyHeader(ctx)
    applyInspector(ctx)
    applyBottomLog(ctx)
    for (const entry of control.snapshot().panes) {
      const node = entry.contribution.render()
      expect(node).not.toBeNull()
      uiRows(entry.id, node!)
    }
    uiRows('example.overlay.details', ui.surface({
      chrome: 'overlay',
      title: overlayRequest.title,
      padding: 1,
      child: overlayRequest.render(),
    }))
    consumer.dispose()
    owner.dispose()
  })

  it('scans adversarial shared-kit content at every repository width', () => {
    for (const fixture of ADVERSARIAL) {
      uiRows(`user-kit:${fixture.name}`, summaryMetric.render({
        label: fixture.text,
        value: fixture.text,
        detail: fixture.text,
      }))
    }
  })

  it('scans custom status output with core status width truth', () => {
    const viewport = { columns: 120, rows: 3 }
    const snapshot: BlueStatusSnapshot = {
      session: { id: 's', cwd: '/tmp', status: 'running', mode: 'yolo', model: { id: ADVERSARIAL[0]!.text } },
      entries: [], busy: true,
    }
    const result = compileBlueStatusNode(statusProvider.render(snapshot), {
      components, colors: DARK_COLORS, getViewport: () => viewport, screenMode: 'alternate', maxRows: 3,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    for (const width of SCAN_WIDTHS) {
      viewport.columns = width
      expectLinesFit('example.status.compact', result.value.component.renderStatus(width).rows, width)
    }
  })

  it('scans the one-control editor shell with the injected host editor', () => {
    const viewport = { columns: 120, rows: 6 }
    const snapshot: BlueEditorSnapshot = {
      mode: 'plan', busy: true,
      attachments: [{ id: 'a', label: ADVERSARIAL[0]!.text }],
      extensions: [{ id: ADVERSARIAL[1]!.text }],
    }
    const result = compileBlueEditorShellNode(editorProvider.render(snapshot), {
      components, colors: DARK_COLORS, getViewport: () => viewport, screenMode: 'alternate', emit: () => {}, editor: createFakeEditor(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    for (const width of SCAN_WIDTHS) {
      viewport.columns = width
      expectLinesFit('example.editor.focused', result.value.component.renderChecked(width, { dryRun: true }).rows, width)
    }
  })
})
