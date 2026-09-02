/** Canonical chart adapter behavior over simple-ascii-chart. */
import { describe, expect, it } from 'vitest'
import { ui } from '../../ui/src/index.ts'
import { formatChartNumber, renderChartRows } from '../src/chart-renderer.ts'
import type { BlueComponents, BlueSemanticColors } from '../src/types.ts'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../src/width.ts'

const identity = (text: string): string => text
const colors = new Proxy({ logoGradient: [identity] }, { get: (target, key) => key === 'logoGradient' ? target.logoGradient : identity }) as BlueSemanticColors
const components = { visibleWidth, truncateToWidth, wrapText: wrapTextWithAnsi } as BlueComponents

const charts = [
  ui.chart({ chart: 'line', title: 'Latency', xLabel: 'minute', yLabel: 'ms', height: 6, series: [
    { id: 'api', label: 'API', tone: 'accent', points: [{ x: 0, y: 2 }, { x: 1, y: 8 }, { x: 2, y: 4 }] },
    { id: 'worker', label: 'Worker', tone: 'success', points: [{ x: 0, y: 5 }, { x: 1, y: null }, { x: 2, y: 7 }] },
  ] }),
  ui.chart({ chart: 'point', series: [{ id: 'samples', points: [{ x: 0, y: 2 }, { x: 1, y: 6 }] }] }),
  ui.chart({ chart: 'bar', layout: 'grouped', title: 'Jobs', categories: ['Mon', 'Tue'], series: [
    { id: 'ok', tone: 'success', values: [4, 7] },
    { id: 'failed', tone: 'danger', values: [1, 2] },
  ] }),
  ui.chart({ chart: 'bar', layout: 'stacked', categories: ['Mon', 'Tue'], series: [{ id: 'a', values: [2, 3] }, { id: 'b', values: [1, 4] }] }),
  ui.chart({ chart: 'bar', layout: 'normalized', categories: ['Mon', 'Tue'], series: [{ id: 'a', values: [2, 3] }, { id: 'b', values: [1, 4] }] }),
  ui.chart({ chart: 'sparkline', label: 'Load', tone: 'warning', values: [1, 5, null, 3, 8] }),
  ui.chart({ chart: 'heatmap', title: 'CI', columns: ['Linux', 'macOS'], rows: ['Node 22', 'Node 24'], values: [['pass', 'fail'], ['pass', 'pass']], levels: [
    { value: 'pass', label: 'Passed', tone: 'success' },
    { value: 'fail', label: 'Failed', tone: 'danger' },
  ] }),
] as const

describe('renderChartRows', () => {
  it('formats compact decimal summaries without changing scientific exponents', () => {
    expect(formatChartNumber(1.23456)).toBe('1.235')
    expect(formatChartNumber(1.23456e-100)).toBe('1.235e-100')
    expect(formatChartNumber(1_000)).toBe('1000')
  })

  it('renders every v1 chart kind through the vendor adapter', () => {
    for (const chart of charts) {
      const rows = renderChartRows(chart, 80, components, colors)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every(row => visibleWidth(row) <= 80)).toBe(true)
      expect(rows.join('\n')).not.toContain('\x1b')
    }
  })

  it('contains every chart at narrow widths with a chart or textual summary fallback', () => {
    for (const width of [1, 2, 5, 12, 40]) for (const chart of charts) {
      const rows = renderChartRows(chart, width, components, colors)
      expect(rows.every(row => visibleWidth(row) <= width)).toBe(true)
      expect(rows.length).toBeLessThanOrEqual(20)
    }
  })

  it('downsamples a long sparkline to the current width', () => {
    const rows = renderChartRows(ui.chart({ chart: 'sparkline', values: Array.from({ length: 200 }, (_, index) => index) }), 20, components, colors)
    expect(rows).toHaveLength(1)
    expect(visibleWidth(rows[0]!)).toBe(20)
  })

  it('covers bounded summaries, defaults, and empty data without leaking width', () => {
    const decimal = ui.chart({ chart: 'line', series: [
      { id: 'fractional', points: [{ x: 0, y: 1.25 }] },
      { id: 'empty', points: [{ x: 0, y: null }] },
    ] })
    const lineSummary = renderChartRows(decimal, 1, components, colors)
    expect(lineSummary.every(row => visibleWidth(row) <= 1)).toBe(true)

    const legend = renderChartRows(ui.chart({ chart: 'line', series: [
      { id: 'first', points: [{ x: 0, y: 1 }] },
      { id: 'second', points: [{ x: 0, y: 2 }] },
    ] }), 80, components, colors)
    expect(legend.length).toBeGreaterThan(0)

    const bars = ui.chart({ chart: 'bar', yLabel: 'jobs', categories: ['A'], series: [
      { id: 'empty', values: [null] },
    ] })
    expect(renderChartRows(bars, 80, components, colors).length).toBeGreaterThan(0)
    expect(renderChartRows(bars, 1, components, colors).every(row => visibleWidth(row) <= 1)).toBe(true)

    expect(renderChartRows(ui.chart({ chart: 'sparkline', label: 'Empty', values: [] }), 20, components, colors)).toHaveLength(1)
    expect(renderChartRows(ui.chart({ chart: 'sparkline', values: [1] }), Number.NaN, components, colors).every(row => visibleWidth(row) <= 1)).toBe(true)

    const defensiveHeatmap = {
      kind: 'chart', chart: 'heatmap', columns: ['A'], rows: [], values: [[null]],
      levels: [{ value: 'ok', label: 'OK' }],
    } as const
    expect(renderChartRows(defensiveHeatmap, 1, components, colors).every(row => visibleWidth(row) <= 1)).toBe(true)
  })
})
