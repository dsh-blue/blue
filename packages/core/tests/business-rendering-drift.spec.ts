/**
 * @module business-rendering-drift
 * G4 architecture guard keeping terminal presentation mechanics in core.
 */

import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const packagesRoot = resolve(root, 'packages')
const sourceSegment = `${sep}src${sep}`
const coreSourceSegment = `${resolve(root, 'packages/core/src')}${sep}`
const widthHelperNames = new Set(['visibleWidth', 'truncateToWidth', 'wrapText', 'wrapTextWithAnsi'])
const borderGlyph = /[╭╮╰╯│─├┤┬┴┼]/u
const selectionPointer = /^\s*(?:→|›|❯)\s/u
const paddingGlyph = /^(?: +|[─━═█░]+)$/u
const widthName = /(?:width|columns|cells)/iu
const widthOperators = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
])

const approvedWidthMath = new Set([
  'packages/interaction/src/session-commands.ts:const cells = annotations.length * GRID_COLUMNS',
  'packages/transcript/src/banner.ts:const logoWidth = Math.max(...LOGO_ART.map(art => art.length))',
  "packages/transcript/src/status-model.ts:const remaining = width - used - (parts.length > 0 ? 2 : 0)",
  "packages/transcript/src/status-model.ts:const renderWidth = result.ok && result.value.node.kind === 'text'",
  'packages/transcript/src/status-model.ts:used += (parts.length > 1 ? 2 : 0) + partWidth',
  'packages/transcript/src/thinking.ts:const contentWidth = Math.max(1, width - THINKING_INDENT.length)',
  'packages/transcript/src/thinking.ts:const hintWidth = Math.max(0, width - THINKING_INDENT.length)',
])

const approvedPresentation = new Set([
  "border:packages/interaction/src/session-tree.ts:visit(child, depth + 1, index === shown.length - 1 ? '└─' : '├─')",
  "border:packages/transcript/src/agent-group.ts:const branch = isLast ? '└─' : '├─'",
  "border:packages/transcript/src/agent-group.ts:const prefix = isLast ? '   ' : '│  '",
  "border:packages/transcript/src/pane-btw.ts:return this.colors.border('│') + ' ' + clipped + ' '.repeat(padding) + ' ' + this.colors.border('│')",
  "border:packages/transcript/src/pane-todo.ts:this.colors.border('─'.repeat(width)),",
  "border:packages/transcript/src/read-group.ts:const branch = last ? '└─' : '├─'",
  "border:packages/transcript/src/read-group.ts:const continuation = last ? '   ' : '│  '",
  "border:packages/transcript/src/read-group.ts:const windowBranch = windowLast ? '└─' : '├─'",
  "border:packages/transcript/src/read-group.ts:rows.push(...this.renderPreviewRows(read, `${String(continuation)}${windowLast ? '   ' : '│  '}`, cut))",
  "border:packages/transcript/src/search-group.ts:const branch = last ? '└─' : '├─'",
  "border:packages/transcript/src/search-group.ts:const childContinuation = `${String(continuation)}${last ? '   ' : '│  '}`",
  "border:packages/transcript/src/search-group.ts:const continuation = last ? '   ' : '│  '",
  "padding:packages/interaction/src/session-tree.ts:const prefix = depth === 0 ? '' : `${'  '.repeat(depth - 1)}${branch} `",
  "padding:packages/interaction/src/usage.ts:return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))",
  "padding:packages/transcript/src/banner-art.ts:'    ⠃⠏⠿⣿⣿⣿⣿⣿⠿⠟⠇⠂⠃⠃⠃'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner-art.ts:'   ⢀⣀⣰⣰⣰⣰⣰⣼⣼⠜   ⣺⣵⡀    ⢀⡀'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner-art.ts:'  ⠋⣿⣿⣼⣰⣰⣻⣿⣽⣰⣀⠋⢿⣿⣿⣼⣰⡀'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner-art.ts:' ⢀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣵⣐  ⢯⣿⣿⣵⣸⣼⣼⣿⠕'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner-art.ts:'⠂⢯⣿⣵⡀   ⣰⣀ ⠊⢿⣿⣿⣿⣿⡿⠇'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner-art.ts:'⢨⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣽⣐⠂⠯⣿⣿⣿⣿⠿⠇'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner-art.ts:'⢯⣿⣵       ⠫⣿⣿⣿⣽⣼⣿⣿⣿⠗'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner-art.ts:'⣿⡟⠃⠃⠋⠏⠿⣿⣿⣿⣿⣿⣿⠯⢿⣿⣽⣴⣿⣿⡕'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner-art.ts:'⣿⣿      ⠋⢿⣿⣿⣿⣿ ⠋⣿⣿⣿⣿⠁'.padEnd(LOGO_COLS),",
  "padding:packages/transcript/src/banner.ts:return { text: `${truncated}${' '.repeat(pad)}`, style }",
  "padding:packages/transcript/src/banner.ts:{ text: ' '.repeat(LOGO_TEXT_GAP), style: 'logo' },",
  "padding:packages/transcript/src/components.ts:const indent = ' '.repeat(bulletWidth)",
  "padding:packages/transcript/src/pane-btw.ts:return this.colors.border('│') + ' ' + clipped + ' '.repeat(padding) + ' ' + this.colors.border('│')",
  "padding:packages/transcript/src/pane-todo.ts:this.colors.border('─'.repeat(width)),",
  "padding:packages/transcript/src/status-model.ts:: leftText + ' '.repeat(Math.max(0, width - leftWidth - rightWidth)) + rightText",
  "padding:packages/transcript/src/status-model.ts:? ' '.repeat(Math.max(0, width - rightWidth)) + rightText",
  "padding:packages/transcript/src/status-model.ts:? leftText + ' '.repeat(Math.max(0, width - leftWidth))",
  "pointer:packages/interaction/src/update-command.ts:subtitle: [`v${fromVersion} → v${toVersion}`, detail].join(' · ').replace(/ · $/, ''),",
  "pointer:packages/interaction/src/update-command.ts:{ kind: 'divider', label: `v${fromVersion} → v${toVersion}` },",
  'pointer:packages/interaction/src/updater/swap.ts:message: `updated ${input.fromVersion} → ${input.toVersion} · smoke passed · restart dsh to apply — this session keeps running ${input.fromVersion}`,',
  'pointer:packages/transcript/src/pane-btw.ts:lines.push(this.colors.roleUser(this.components.truncateToWidth(`› ${turn.question}`, width)))',
])

interface Audit {
  readonly violations: ReadonlySet<string>
  readonly widthMath: ReadonlySet<string>
  readonly presentation: ReadonlySet<string>
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (entry.name.endsWith('.ts')) files.push(path)
  }
  return files
}

async function businessSourceFiles(): Promise<string[]> {
  return (await sourceFiles(packagesRoot)).filter(path =>
    path.includes(sourceSegment) && !path.includes(coreSourceSegment))
}

function sourceLine(source: string, node: ts.Node): string {
  const start = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line
  return source.split('\n')[start]?.trim() ?? ''
}

function record(path: string, source: string, node: ts.Node): string {
  return `${path}:${sourceLine(source, node)}`
}

function containsLength(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'length') return true
  return node.getChildren().some(containsLength)
}

function containsWidthName(node: ts.Node): boolean {
  if (ts.isIdentifier(node) && widthName.test(node.text)) return true
  return node.getChildren().some(containsWidthName)
}

function stringValue(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TemplateHead
    || node.kind === ts.SyntaxKind.TemplateMiddle
    || node.kind === ts.SyntaxKind.TemplateTail) return (node as ts.TemplateLiteralToken).text
  return undefined
}

function auditSource(path: string, source: string): Audit {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const violations = new Set<string>()
  const widthMath = new Set<string>()
  const presentation = new Set<string>()

  const violate = (node: ts.Node, reason: string): void => {
    violations.add(`${reason}:${record(path, source, node)}`)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text
      if (moduleName.startsWith('@earendil-works/pi-tui')
        || moduleName === '@dsh-blue/blue-core/chrome'
        || moduleName === '@dsh-blue/blue-core/width') {
        violate(node, 'renderer-import')
      }
      if (moduleName === '@dsh-blue/blue-core' && node.importClause !== undefined) {
        const bindings = node.importClause.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text
            if (widthHelperNames.has(imported)) violate(element, 'width-helper-import')
          }
        }
      }
    }

    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))
      && ts.isIdentifier(node.name)) {
      if (widthHelperNames.has(node.name.text)) violate(node, 'local-width-helper')
      if (node.initializer !== undefined && widthName.test(node.name.text)
        && containsLength(node.initializer)) {
        widthMath.add(record(path, source, node))
      }
    }

    if (ts.isBinaryExpression(node) && widthOperators.has(node.operatorToken.kind)
      && ((containsLength(node.left) && containsWidthName(node.right))
        || (containsLength(node.right) && containsWidthName(node.left)))) {
      widthMath.add(record(path, source, node))
    }

    const value = stringValue(node)
    if (value !== undefined) {
      if (borderGlyph.test(value)) presentation.add(`border:${record(path, source, node)}`)
      if (selectionPointer.test(value)) presentation.add(`pointer:${record(path, source, node)}`)
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = stringValue(node.expression.expression)
      if ((method === 'repeat' && receiver !== undefined && paddingGlyph.test(receiver))
        || method === 'padEnd') {
        presentation.add(`padding:${record(path, source, node)}`)
      }
      if (method === 'join' && sourceLine(source, node).match(/Array(?:\.from)?\([^)]*width[^)]*\).*\.fill\(['"] ['"]\)/iu)) {
        violate(node, 'local-padding-math')
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(file)
  return { violations, widthMath, presentation }
}

function merge(target: Set<string>, values: ReadonlySet<string>): void {
  for (const value of values) target.add(value)
}

describe('business package rendering drift guard', () => {
  it('detects representative renderer-import, width, pointer, border, and padding drift', () => {
    const audit = auditSource('positive-fixture.ts', `
import { visibleWidth as columns } from '@dsh-blue/blue-core'
const widthOf = (text: string) => Array.from(text).length
const available = width - columns(text)
const pointer = '  → active'
const border = '\\u2502'
const padding = Array(width).fill(' ').join('')
void [widthOf, available, pointer, border, padding]
`)
    expect([...audit.violations].map(value => value.split(':', 1)[0])).toEqual([
      'width-helper-import',
      'local-padding-math',
    ])
    expect(audit.widthMath).toEqual(new Set([
      'positive-fixture.ts:const widthOf = (text: string) => Array.from(text).length',
    ]))
    expect(audit.presentation).toEqual(new Set([
      "pointer:positive-fixture.ts:const pointer = '  → active'",
      "border:positive-fixture.ts:const border = '\\u2502'",
    ]))
  })

  it('keeps renderer helpers and local display-width implementations inside core', async () => {
    const violations = new Set<string>()
    const widthMath = new Set<string>()
    for (const absolutePath of await businessSourceFiles()) {
      const path = relative(root, absolutePath)
      const audit = auditSource(path, await readFile(absolutePath, 'utf8'))
      merge(violations, audit.violations)
      merge(widthMath, audit.widthMath)
    }
    expect(violations).toEqual(new Set())
    expect(widthMath).toEqual(approvedWidthMath)
  })

  it('requires an exact baseline review for business-owned pointers, borders and padding', async () => {
    const presentation = new Set<string>()
    for (const absolutePath of await businessSourceFiles()) {
      const path = relative(root, absolutePath)
      const audit = auditSource(path, await readFile(absolutePath, 'utf8'))
      merge(presentation, audit.presentation)
    }
    expect(presentation).toEqual(approvedPresentation)
  })
})
