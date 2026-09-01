/**
 * Width-contained adapter from canonical Blue chart nodes to simple-ascii-chart.
 *
 * @module @dsh-blue/blue-core/chart-renderer
 */

import type { BlueChartNode, BlueTone } from '@dsh-blue/blue-api'
import { heatmap, plot, renderChart, sparkline, type Color } from 'simple-ascii-chart'
import { paintPluginTone } from './plugin-view.ts'
import type { BlueComponents, BlueSemanticColors } from './types.ts'

const TONE_COLOR: Readonly<Record<BlueTone, Color>> = {
  default: 'ansiWhite',
  muted: 'ansiBrightBlack',
  accent: 'ansiCyan',
  success: 'ansiGreen',
  warning: 'ansiYellow',
  danger: 'ansiRed',
}
const COLOR_CODE: Readonly<Record<Color, number>> = {
  ansiBlack: 30, ansiRed: 31, ansiGreen: 32, ansiYellow: 33,
  ansiBlue: 34, ansiMagenta: 35, ansiCyan: 36, ansiWhite: 37,
  ansiBrightBlack: 90, ansiBrightRed: 91, ansiBrightGreen: 92, ansiBrightYellow: 93,
  ansiBrightBlue: 94, ansiBrightMagenta: 95, ansiBrightCyan: 96, ansiBrightWhite: 97,
}
const DEFAULT_TONES: readonly BlueTone[] = ['accent', 'success', 'warning', 'danger', 'muted', 'default']

function toneAt(tone: BlueTone | undefined, index: number): BlueTone {
  return tone ?? DEFAULT_TONES[index % DEFAULT_TONES.length]!
}

function vendorColor(tone: BlueTone): Color {
  return TONE_COLOR[tone]
}

function applyTheme(output: string, tones: readonly BlueTone[], colors: BlueSemanticColors): string {
  const byCode = new Map(tones.map(tone => [COLOR_CODE[vendorColor(tone)], tone]))
  return output.replace(/\x1b\[(\d+)m([^\x1b]*)\x1b\[0m/gu, (_match, rawCode: string, body: string) => {
    const tone = byCode.get(Number(rawCode))
    return tone === undefined ? body : paintPluginTone(colors, tone)(body)
  })
}

function rows(output: string): string[] {
  const result = output.replaceAll('\r\n', '\n').split('\n')
  while (result.length > 0 && result[0] === '') result.shift()
  while (result.length > 0 && result.at(-1) === '') result.pop()
  return result
}

function checkedRows(
  render: (plotWidth: number, compact: boolean) => string,
  width: number,
  tones: readonly BlueTone[],
  components: BlueComponents,
  colors: BlueSemanticColors,
): string[] | undefined {
  for (const compact of [false, true]) {
    let plotWidth = Math.max(4, width - (compact ? 2 : 8))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const themed = rows(applyTheme(render(plotWidth, compact), tones, colors))
        const widest = themed.reduce((maximum, row) => Math.max(maximum, components.visibleWidth(row)), 0)
        if (themed.length > 0 && widest <= width) return themed
        plotWidth = Math.max(4, plotWidth - Math.max(1, widest - width + 1))
      } catch { break }
    }
  }
  return undefined
}

function numeric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(4).replace(/\.?0+$/u, '')
}

function summary(node: Exclude<BlueChartNode, { readonly chart: 'sparkline' }>, width: number, components: BlueComponents, colors: BlueSemanticColors): string[] {
  const result: string[] = []
  if ('title' in node && node.title !== undefined) result.push(colors.textStrong(components.truncateToWidth(node.title, width)))
  switch (node.chart) {
    case 'line':
    case 'point':
      for (const [index, series] of node.series.entries()) {
        const values = series.points.flatMap(point => point.y === null ? [] : [point.y])
        const detail = values.length === 0 ? 'no data' : `min ${numeric(Math.min(...values))}, max ${numeric(Math.max(...values))}, last ${numeric(values.at(-1)!)}`
        result.push(paintPluginTone(colors, toneAt(series.tone, index))(components.truncateToWidth(`${series.label ?? series.id}: ${detail}`, width)))
      }
      break
    case 'bar':
      for (const [index, series] of node.series.entries()) {
        const values = series.values.flatMap(value => value === null ? [] : [value])
        const detail = values.length === 0 ? 'no data' : `total ${numeric(values.reduce((sum, value) => sum + value, 0))}`
        result.push(paintPluginTone(colors, toneAt(series.tone, index))(components.truncateToWidth(`${series.label ?? series.id}: ${detail}`, width)))
      }
      break
    case 'heatmap':
      for (const [index, row] of node.values.entries()) {
        result.push(components.truncateToWidth(`${node.rows[index] ?? ''}: ${row.map(value => value ?? '-').join(' ')}`, width))
      }
  }
  return result.slice(0, 20)
}

function renderNumeric(node: Extract<BlueChartNode, { readonly chart: 'line' | 'point' }>, width: number, components: BlueComponents, colors: BlueSemanticColors): string[] | undefined {
  const tones = node.series.map((series, index) => toneAt(series.tone, index))
  return checkedRows((plotWidth, compact) => plot(
    node.series.map(series => series.points.map(point => [point.x, point.y] as const)),
    {
      width: plotWidth,
      height: node.height ?? 10,
      mode: node.chart,
      interpolation: 'linear',
      overflow: 'clip',
      color: tones.map(vendorColor),
      ...(compact ? { hideXAxisTicks: true, hideYAxisTicks: true } : {
        showTickLabel: true,
        ...(node.title === undefined ? {} : { title: components.truncateToWidth(node.title, width) }),
        ...(node.xLabel === undefined ? {} : { xLabel: components.truncateToWidth(node.xLabel, width) }),
        ...(node.yLabel === undefined ? {} : { yLabel: components.truncateToWidth(node.yLabel, width) }),
        ...(node.series.length < 2 ? {} : { legend: { position: 'bottom' as const, series: node.series.map(series => series.label ?? series.id) } }),
      }),
    },
  ), width, tones, components, colors)
}

function renderBars(node: Extract<BlueChartNode, { readonly chart: 'bar' }>, width: number, components: BlueComponents, colors: BlueSemanticColors): string[] | undefined {
  const tones = node.series.map((series, index) => toneAt(series.tone, index))
  return checkedRows((plotWidth, compact) => renderChart({
    width: plotWidth,
    height: node.height ?? 10,
    series: node.series.map((series, index) => ({
      id: series.id,
      name: series.label ?? series.id,
      data: node.categories.map((category, categoryIndex) => [category, series.values[categoryIndex] ?? null] as const),
      mode: 'bar' as const,
      color: vendorColor(tones[index]!),
    })),
    xAxis: { scale: 'band' as const, ...(compact ? { ticks: 0 } : {}) },
    ...(compact || node.yLabel === undefined ? {} : { yAxis: { label: components.truncateToWidth(node.yLabel, width) } }),
    ...(compact || node.title === undefined ? {} : { title: components.truncateToWidth(node.title, width) }),
    ...(compact || node.series.length < 2 ? {} : { legend: { position: 'bottom' as const, series: true } }),
    barLayout: node.layout ?? 'grouped',
  }), width, tones, components, colors)
}

function sampleValues(values: readonly (number | null)[], size: number): readonly (number | null)[] {
  if (values.length <= size) return values
  return Array.from({ length: size }, (_, index) => values[Math.round(index * (values.length - 1) / Math.max(1, size - 1))]!)
}

function renderSparkline(node: Extract<BlueChartNode, { readonly chart: 'sparkline' }>, width: number, components: BlueComponents, colors: BlueSemanticColors): string[] {
  const tone = toneAt(node.tone, 0)
  const label = node.label === undefined ? [] : [colors.textStrong(components.truncateToWidth(node.label, width))]
  if (node.values.length === 0) return label
  const output = applyTheme(sparkline(sampleValues(node.values, width), { color: vendorColor(tone) }), [tone], colors)
  return [...label, components.truncateToWidth(output, width)]
}

function renderHeatmap(node: Extract<BlueChartNode, { readonly chart: 'heatmap' }>, width: number, components: BlueComponents, colors: BlueSemanticColors): string[] | undefined {
  const tones = node.levels.map((level, index) => toneAt(level.tone, index))
  const symbols = ['●', '◆', '■', '▲', '○', '◇'] as const
  for (const compact of [false, true]) {
    try {
      const output = heatmap({
        columns: node.columns.map(label => compact ? components.truncateToWidth(label, 6) : label),
        rows: node.rows.map(label => compact ? components.truncateToWidth(label, 8) : label),
        data: node.values,
        levels: node.levels.map((level, index) => ({
          value: level.value,
          label: level.label,
          symbol: symbols[index % symbols.length]!,
          color: vendorColor(tones[index]!),
        })),
        ...(compact || node.title === undefined ? {} : { title: components.truncateToWidth(node.title, width) }),
        legend: !compact,
      })
      const themed = rows(applyTheme(output, tones, colors))
      if (themed.every(row => components.visibleWidth(row) <= width)) return themed
    } catch { /* the bounded summary below is the defined fallback */ }
  }
  return undefined
}

/** Render one canonical chart, falling back to a bounded textual summary. */
export function renderChartRows(node: BlueChartNode, width: number, components: BlueComponents, colors: BlueSemanticColors): string[] {
  const safeWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
  switch (node.chart) {
    case 'sparkline': return renderSparkline(node, safeWidth, components, colors)
    case 'line':
    case 'point': return renderNumeric(node, safeWidth, components, colors) ?? summary(node, safeWidth, components, colors)
    case 'bar': return renderBars(node, safeWidth, components, colors) ?? summary(node, safeWidth, components, colors)
    case 'heatmap': return renderHeatmap(node, safeWidth, components, colors) ?? summary(node, safeWidth, components, colors)
  }
}
