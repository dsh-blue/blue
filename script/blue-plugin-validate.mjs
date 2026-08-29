#!/usr/bin/env node
/**
 * Static package and architecture validator for Blue frontend entries. A v1
 * package is discovered only through package.json.blue.manifest; its selected
 * public export closure is the architecture boundary under inspection.
 *
 * @module script/blue-plugin-validate
 */
import { execFileSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { intersects, validRange } from 'semver'
import ts from 'typescript'

const repositoryRoot = resolve(import.meta.dirname, '..')
const argument = process.argv.slice(2).find(value => value !== '--') ?? '.'
const root = resolve(argument)
const reproduceTarget = relative(repositoryRoot, root)
const reproduce = `node script/blue-plugin-validate.mjs ${reproduceTarget === '' ? '.' : reproduceTarget.startsWith(`..${sep}`) ? root : reproduceTarget}`
const packageFile = resolve(root, 'package.json')
const protocol = await import(pathToFileURL(resolve(repositoryRoot, 'packages/api/src/protocol-v1.ts')).href)
const legacyProtocol = await import(pathToFileURL(resolve(repositoryRoot, 'packages/api/src/manifest.ts')).href)

function emitLoadFailure(code, message, status = 2) {
  console.log(JSON.stringify({
    package: root,
    root,
    valid: false,
    files: 0,
    lifecycle: false,
    manifest: { discovered: false, valid: false },
    groups: { package: 1, architecture: 0, lifecycle: 0 },
    violations: [{ package: root, group: 'package', code, message, reproduce }],
  }, null, 2))
  process.exit(status)
}

if (!existsSync(packageFile)) emitLoadFailure('PACKAGE_MANIFEST_MISSING', `package.json not found: ${root}`)
let packageFileInfo
try {
  packageFileInfo = lstatSync(packageFile)
} catch {
  emitLoadFailure('PACKAGE_MANIFEST_UNREADABLE', `package.json cannot be inspected: ${root}`)
}
if (!packageFileInfo.isFile()) emitLoadFailure('PACKAGE_MANIFEST_NOT_FILE', `package.json is not a regular file: ${root}`)

let packageManifest
try {
  packageManifest = JSON.parse(readFileSync(packageFile, 'utf8'))
} catch {
  emitLoadFailure('PACKAGE_MANIFEST_INVALID_JSON', `package.json is not valid JSON: ${root}`)
}
if (packageManifest === null || typeof packageManifest !== 'object' || Array.isArray(packageManifest)) {
  emitLoadFailure('PACKAGE_MANIFEST_INVALID', `package.json must contain an object: ${root}`)
}

const packageName = typeof packageManifest.name === 'string' ? packageManifest.name : root
const realRoot = realpathSync(root)
const sourceRoot = resolve(root, 'src')
const canonicalDistributionManifestPath = resolve(root, 'blue.plugin.json')
const manifestCandidate = packageManifest.blue?.manifest !== undefined || existsSync(canonicalDistributionManifestPath)
const sourceFiles = []
const violations = []

function violate(group, code, message) {
  violations.push({ package: packageName, group, code, message, reproduce })
}

function walk(dir, files = sourceFiles) {
  if (!existsSync(dir)) return files
  let entries
  try {
    entries = readdirSync(dir)
  } catch (error) {
    violate('package', 'PACKAGE_SOURCE_SCAN_FAILED', `cannot read source directory ${relative(root, dir)}: ${String(error)}`)
    return files
  }
  for (const entry of entries) {
    const path = resolve(dir, entry)
    let info
    try {
      info = lstatSync(path)
    } catch (error) {
      violate('package', 'PACKAGE_SOURCE_SCAN_FAILED', `cannot inspect source path ${relative(root, path)}: ${String(error)}`)
      continue
    }
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) walk(path, files)
    else if (/\.(?:mjs|cjs|js|ts|tsx)$/u.test(entry) && !entry.endsWith('.d.ts')) {
      if (info.isFile()) files.push(path)
      else violate('package', 'PACKAGE_SOURCE_NOT_REGULAR_FILE', `source path is not a regular file: ${relative(root, path)}`)
    }
  }
  return files
}
if (!manifestCandidate) walk(sourceRoot)

const ESM_CONDITIONS = new Set(['import', 'module-sync', 'node', 'node-addons'])

function exportTarget(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = exportTarget(candidate)
      if (target !== undefined) return target
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  for (const [condition, candidate] of Object.entries(value)) {
    if (condition !== 'default' && !ESM_CONDITIONS.has(condition)) continue
    const target = exportTarget(candidate)
    if (target !== undefined) return target
  }
  return undefined
}

function typesTarget(value) {
  if (value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = typesTarget(candidate)
      if (target !== undefined) return target
    }
    return undefined
  }
  for (const [condition, candidate] of Object.entries(value)) {
    if (condition === 'types') {
      const target = exportTarget(candidate)
      if (target !== undefined) return target
      continue
    }
    if (condition !== 'default' && !ESM_CONDITIONS.has(condition)) continue
    const target = typesTarget(candidate)
    if (target !== undefined) return target
  }
  return undefined
}

function exportValue(exportsMap, key) {
  if (typeof exportsMap === 'string') return key === '.' ? exportsMap : undefined
  if (exportsMap === null || typeof exportsMap !== 'object') return undefined
  const keys = Object.keys(exportsMap)
  if (keys.some(value => value.startsWith('.'))) return exportsMap[key]
  return key === '.' ? exportsMap : undefined
}

function exportedEntries(exportsMap) {
  if (typeof exportsMap === 'string') return [['.', exportsMap]]
  if (exportsMap === null || typeof exportsMap !== 'object') return []
  const entries = Object.entries(exportsMap)
  return entries.some(([key]) => key.startsWith('.')) ? entries : [['.', exportsMap]]
}

function filesEntryMatches(entry, target) {
  const normalized = target.replace(/^\.\//u, '')
  if (!entry.includes('*')) return normalized === entry || normalized.startsWith(`${entry}/`)
  let pattern = ''
  for (let index = 0; index < entry.length;) {
    if (entry.startsWith('**/', index)) { pattern += '(?:.*/)?'; index += 3; continue }
    if (entry.startsWith('**', index)) { pattern += '.*'; index += 2; continue }
    if (entry[index] === '*') { pattern += '[^/]*'; index += 1; continue }
    pattern += entry[index].replace(/[.+^${}()|[\]\\]/gu, String.raw`\$&`)
    index += 1
  }
  return new RegExp(`^${pattern}$`, 'u').test(normalized)
}

function filesWhitelistCoverage(entries, target) {
  const patterns = entries.map(String)
  if (patterns.some(pattern => [...pattern].some(character => '?[]{}!()+@\\'.includes(character)))) {
    return undefined
  }
  return patterns.some(pattern => filesEntryMatches(pattern, target))
}

function lexicalPackagePath(file) {
  const value = relative(root, resolve(file))
  if (value === '' || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) return undefined
  return value
}

function packageRelativePath(file) {
  const lexical = lexicalPackagePath(file)
  if (lexical === undefined) return undefined
  let cursor = root
  try {
    for (const segment of lexical.split(sep)) {
      cursor = join(cursor, segment)
      if (lstatSync(cursor).isSymbolicLink()) return undefined
    }
  } catch {
    return undefined
  }
  let canonical
  try {
    canonical = relative(realRoot, realpathSync(file))
  } catch {
    return undefined
  }
  if (canonical === '' || canonical === '..' || canonical.startsWith(`..${sep}`) || isAbsolute(canonical)) return undefined
  return lexical.split(sep).join('/')
}

function targetPath(target) {
  if (!target.startsWith('./')) return undefined
  const path = resolve(root, target)
  if (!existsSync(path) || packageRelativePath(path) === undefined || !lstatSync(path).isFile()) return undefined
  return path
}

function declarationFile(file) {
  return /\.d\.(?:c|m)?ts$/u.test(file)
}

function adjacentDeclarationTargets(runtimeTarget) {
  if (!runtimeTarget?.startsWith('./')) return []
  const extension = extname(runtimeTarget)
  const stem = extension === '' ? runtimeTarget : runtimeTarget.slice(0, -extension.length)
  const candidates = extension === '.mjs'
    ? [`${stem}.mts`, `${stem}.d.mts`, `${stem}.d.ts`]
    : extension === '.cjs'
      ? [`${stem}.cts`, `${stem}.d.cts`, `${stem}.d.ts`]
      : extension === '.js' || extension === '.jsx'
        ? [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`]
        : extension === ''
          ? [`${runtimeTarget}.ts`, `${runtimeTarget}.tsx`, `${runtimeTarget}.d.ts`]
          : []
  return candidates.filter(candidate => existsSync(resolve(root, candidate)))
}

let rootDeclarationResolved = false
let rootDeclarationValue

function rootDeclarationTarget(key) {
  if (key !== '.') return undefined
  if (rootDeclarationResolved) return rootDeclarationValue
  rootDeclarationResolved = true
  const value = packageManifest.types ?? packageManifest.typings
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '' || isAbsolute(value) || /^[a-z]+:/iu.test(value)) {
    violate('package', 'PACKAGE_TYPES_TARGET_INVALID', `package types target must stay package-relative: ${String(value)}`)
    return undefined
  }
  rootDeclarationValue = value.startsWith('./') ? value : `./${value}`
  return rootDeclarationValue
}

function declarationTargets(value, key, runtimeTarget) {
  const explicit = typesTarget(value)
  if (explicit !== undefined) return [explicit]
  return [...new Set([
    rootDeclarationTarget(key),
    ...adjacentDeclarationTargets(runtimeTarget),
  ].filter(target => target !== undefined))]
}

function selfReferenceExportKey(specifier) {
  if (specifier === packageName) return '.'
  if (specifier.startsWith(`${packageName}/`)) return `.${specifier.slice(packageName.length)}`
  return undefined
}

function exportPatternMatches(pattern, key) {
  const wildcard = pattern.indexOf('*')
  if (wildcard < 0) return false
  const prefix = pattern.slice(0, wildcard)
  const suffix = pattern.slice(wildcard + 1)
  return key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length
}

const sourceFactsCache = new Map()

function literalSpecifier(node) {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined
}

function unwrapExpression(expression) {
  let value = expression
  while (value !== undefined && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isTypeAssertionExpression(value))) {
    value = value.expression
  }
  return value
}

function memberName(expression) {
  const value = unwrapExpression(expression)
  if (ts.isPropertyAccessExpression(value)) return value.name.text
  if (ts.isElementAccessExpression(value)) return literalSpecifier(value.argumentExpression)
  return undefined
}

function sourceFacts(source, file = 'entry.ts') {
  const cacheKey = `${file}\0${source}`
  const cached = sourceFactsCache.get(cacheKey)
  if (cached !== undefined) return cached
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const moduleSpecifiers = []
  const dynamicLoads = []
  let rawTerminal = false
  let rendererGlobal = false
  let ansi = false
  let sessionEventFolding = false
  let lifecycle = false
  const requireBindings = new Set(['require'])
  const createRequireBindings = new Set()
  const moduleNamespaceBindings = new Set()
  const add = node => {
    const value = literalSpecifier(node)
    if (value !== undefined) moduleSpecifiers.push(value)
    return value !== undefined
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !['module', 'node:module'].includes(literalSpecifier(statement.moduleSpecifier))) continue
    const clause = statement.importClause
    if (clause?.name !== undefined) moduleNamespaceBindings.add(clause.name.text)
    if (clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
      moduleNamespaceBindings.add(clause.namedBindings.name.text)
    } else if (clause?.namedBindings !== undefined) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'createRequire') createRequireBindings.add(element.name.text)
      }
    }
  }

  const expressionRole = expression => {
    const value = unwrapExpression(expression)
    if (value === undefined) return undefined
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.CommaToken) return expressionRole(value.right)
    if (ts.isIdentifier(value)) {
      if (requireBindings.has(value.text)) return 'require'
      if (createRequireBindings.has(value.text)) return 'createRequire'
      if (moduleNamespaceBindings.has(value.text)) return 'moduleNamespace'
      return undefined
    }
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const operation = memberName(value)
      const owner = unwrapExpression(value.expression)
      const ownerRole = expressionRole(owner)
      if (operation === 'require' && ts.isIdentifier(owner) && owner.text === 'module') return 'require'
      if (operation === 'resolve' && ownerRole === 'require') return 'require'
      if (operation === 'createRequire' && ownerRole === 'moduleNamespace') return 'createRequire'
      return undefined
    }
    if (ts.isCallExpression(value) && expressionRole(value.expression) === 'createRequire') return 'require'
    return undefined
  }

  const loadsNodeModule = expression => {
    const value = unwrapExpression(expression)
    return ts.isCallExpression(value)
      && expressionRole(value.expression) === 'require'
      && ['module', 'node:module'].includes(literalSpecifier(value.arguments[0]))
  }

  let bindingsChanged = true
  while (bindingsChanged) {
    bindingsChanged = false
    const collectBinding = node => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const role = expressionRole(node.initializer)
        if (ts.isIdentifier(node.name)) {
          const target = loadsNodeModule(node.initializer)
            ? moduleNamespaceBindings
            : role === 'require'
              ? requireBindings
            : role === 'createRequire'
              ? createRequireBindings
              : role === 'moduleNamespace'
                ? moduleNamespaceBindings
                : undefined
          if (target !== undefined && !target.has(node.name.text)) {
            target.add(node.name.text)
            bindingsChanged = true
          }
        } else if (ts.isObjectBindingPattern(node.name) && (role === 'moduleNamespace' || loadsNodeModule(node.initializer))) {
          for (const element of node.name.elements) {
            const imported = element.propertyName !== undefined && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
              ? element.propertyName.text
              : ts.isIdentifier(element.name) ? element.name.text : undefined
            if (imported === 'createRequire' && ts.isIdentifier(element.name) && !createRequireBindings.has(element.name.text)) {
              createRequireBindings.add(element.name.text)
              bindingsChanged = true
            }
          }
        }
      }
      ts.forEachChild(node, collectBinding)
    }
    collectBinding(sourceFile)
  }

  const unsafeLoaderExpression = expression => {
    const value = unwrapExpression(expression)
    if (value === undefined) return false
    if (expressionRole(value) !== undefined) return true
    if (ts.isConditionalExpression(value)) return unsafeLoaderExpression(value.whenTrue) || unsafeLoaderExpression(value.whenFalse)
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return unsafeLoaderExpression(value.left) || unsafeLoaderExpression(value.right)
    }
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const owner = unwrapExpression(value.expression)
      if (ts.isIdentifier(owner) && owner.text === 'module') return true
      return unsafeLoaderExpression(owner)
    }
    return false
  }

  const dynamicLoadKeys = new Set()
  const addDynamicLoad = (kind, node) => {
    const position = node.getStart(sourceFile)
    const key = `${kind}:${position}`
    if (dynamicLoadKeys.has(key)) return
    dynamicLoadKeys.add(key)
    dynamicLoads.push({ kind, position })
  }
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    } else if (ts.isCallExpression(node)) {
      const expression = node.expression
      const importCall = expression.kind === ts.SyntaxKind.ImportKeyword
      const role = expressionRole(expression)
      if (importCall || role === 'require') {
        if (!add(node.arguments[0])) addDynamicLoad(importCall ? 'import' : 'require', node)
      } else if (role !== 'createRequire' && unsafeLoaderExpression(expression)) {
        addDynamicLoad('require', node)
      }
      for (const argument of node.arguments) {
        if (expressionRole(argument) === 'require' || expressionRole(argument) === 'createRequire' || unsafeLoaderExpression(argument)) {
          addDynamicLoad('require', argument)
        }
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const operation = expression.name.text
        if (['effect', 'dispose', 'register', 'subscribe'].includes(operation)) lifecycle = true
        if (operation === 'setRawMode') rawTerminal = true
        if (operation === 'events' && ts.isIdentifier(expression.expression) && expression.expression.text === 'session') sessionEventFolding = true
      } else if (ts.isIdentifier(expression)) {
        if (expression.text === 'rawMode') rawTerminal = true
        if (expression.text === 'foldSessionEvents' || expression.text === 'applySessionEvent') sessionEventFolding = true
        if (expression.text === 'unload') lifecycle = true
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : undefined
      if (name === 'unload') lifecycle = true
    }
    if (declarationFile(file) && ts.isIdentifier(node)
      && (/^HTML[A-Za-z]*Element$/u.test(node.text)
        || /^(?:React|Document|Window|CSSStyleDeclaration|DOMRect|DOMRectReadOnly|NodeList|NodeListOf|MutationObserver|ResizeObserver|IntersectionObserver|EventTarget|KeyboardEvent|MouseEvent|PointerEvent|TouchEvent|DragEvent|ClipboardEvent)$/u.test(node.text))) {
      rendererGlobal = true
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) rendererGlobal = true
    if (ts.isStringLiteralLike(node) || node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const text = node.getText(sourceFile)
      if (/\x1b|\\x1b|\\u001b/iu.test(text)) ansi = true
    }
    if (ts.isPropertyAccessExpression(node)
      && node.name.text === 'columns'
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'process'
      && (node.expression.name.text === 'stdout' || node.expression.name.text === 'stderr')) {
      rawTerminal = true
    }
    for (const jsDoc of node.jsDoc ?? []) visit(jsDoc)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  const facts = {
    moduleSpecifiers,
    referencePaths: sourceFile.referencedFiles.map(reference => reference.fileName),
    referenceTypes: sourceFile.typeReferenceDirectives.map(reference => reference.fileName),
    referenceLibs: sourceFile.libReferenceDirectives.map(reference => reference.fileName),
    diagnostics: sourceFile.parseDiagnostics,
    dynamicLoads,
    rawTerminal,
    rendererGlobal,
    ansi,
    sessionEventFolding,
    lifecycle,
    sourceFile,
  }
  sourceFactsCache.set(cacheKey, facts)
  return facts
}

function importSpecifiers(source, file) {
  return sourceFacts(source, file).moduleSpecifiers
}

function referenceTypeSpecifiers(source, file) {
  return sourceFacts(source, file).referenceTypes
}

function exportedModifier(node) {
  return node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
}

function commonJsExportName(left) {
  if (ts.isPropertyAccessExpression(left)) {
    if (ts.isIdentifier(left.expression) && left.expression.text === 'exports') return left.name.text
    if (ts.isPropertyAccessExpression(left.expression)
      && ts.isIdentifier(left.expression.expression)
      && left.expression.expression.text === 'module'
      && left.expression.name.text === 'exports') return left.name.text
  }
  if (ts.isElementAccessExpression(left) && literalSpecifier(left.argumentExpression) !== undefined) {
    if (ts.isIdentifier(left.expression) && left.expression.text === 'exports') return literalSpecifier(left.argumentExpression)
    if (ts.isPropertyAccessExpression(left.expression)
      && ts.isIdentifier(left.expression.expression)
      && left.expression.expression.text === 'module'
      && left.expression.name.text === 'exports') return literalSpecifier(left.argumentExpression)
  }
  return undefined
}

function stableInjectInitializer(initializer) {
  const value = unwrapExpression(initializer)
  if (value === undefined) return false
  if (ts.isArrayLiteralExpression(value)) return true
  const frozenValue = ts.isCallExpression(value) ? unwrapExpression(value.arguments[0]) : undefined
  return ts.isCallExpression(value)
    && ts.isPropertyAccessExpression(value.expression)
    && ts.isIdentifier(value.expression.expression)
    && value.expression.expression.text === 'Object'
    && value.expression.name.text === 'freeze'
    && frozenValue !== undefined
    && ts.isArrayLiteralExpression(frozenValue)
}

function functionNode(expression, bindings, seen = new Set()) {
  const value = unwrapExpression(expression)
  if (value === undefined) return undefined
  if (ts.isFunctionDeclaration(value) || ts.isFunctionExpression(value) || ts.isArrowFunction(value) || ts.isMethodDeclaration(value)) return value
  if (!ts.isIdentifier(value) || seen.has(value.text)) return undefined
  seen.add(value.text)
  const binding = bindings.get(value.text)
  if (binding?.kind === 'function') return binding.node
  return functionNode(binding?.initializer, bindings, seen)
}

function staticBoolean(expression) {
  const value = unwrapExpression(expression)
  if (value?.kind === ts.SyntaxKind.TrueKeyword) return true
  if (value?.kind === ts.SyntaxKind.FalseKeyword) return false
  if (value?.kind === ts.SyntaxKind.NullKeyword) return false
  if (ts.isNumericLiteral(value)) return Number(value.text) !== 0
  if (ts.isStringLiteralLike(value)) return value.text.length > 0
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = staticBoolean(value.operand)
    return operand === undefined ? undefined : !operand
  }
  return undefined
}

function applyOwnsLifecycle(applyNode, bindings) {
  const visited = new Set()
  const lifecycleOperations = new Set(['dispose', 'effect', 'open', 'plugin', 'register', 'subscribe', 'unload'])
  const reachableBindings = new Map(bindings)

  const collectNestedBindings = node => {
    if (node === undefined) return
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      reachableBindings.set(node.name.text, { kind: 'function', constant: true, node })
      return
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const value = unwrapExpression(node.initializer)
      if (ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
        reachableBindings.set(node.name.text, { kind: 'variable', constant: true, initializer: value, node })
      }
    }
    ts.forEachChild(node, collectNestedBindings)
  }
  collectNestedBindings(applyNode.body)

  const visitFunction = node => {
    if (visited.has(node)) return false
    visited.add(node)
    return visit(node.body)
  }

  const visit = node => {
    if (node === undefined) return false
    if (ts.isBlock(node)) {
      for (const statement of node.statements) {
        if (visit(statement)) return true
        if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) break
      }
      return false
    }
    if (ts.isIfStatement(node)) {
      if (visit(node.expression)) return true
      const condition = staticBoolean(node.expression)
      if (condition !== false && visit(node.thenStatement)) return true
      return condition !== true && visit(node.elseStatement)
    }
    if (ts.isConditionalExpression(node)) {
      if (visit(node.condition)) return true
      const condition = staticBoolean(node.condition)
      if (condition !== false && visit(node.whenTrue)) return true
      return condition !== true && visit(node.whenFalse)
    }
    if ((ts.isWhileStatement(node) || ts.isForStatement(node)) && node.expression !== undefined && staticBoolean(node.expression) === false) {
      return visit(node.expression)
    }
    if (ts.isCallExpression(node)) {
      if (lifecycleOperations.has(memberName(node.expression) ?? '')) return true
      const called = functionNode(node.expression, reachableBindings)
      if (called !== undefined && visitFunction(called)) return true
    }
    if (ts.isReturnStatement(node) && functionNode(node.expression, reachableBindings) !== undefined) return true
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node !== applyNode) return false
    let found = false
    ts.forEachChild(node, child => {
      if (!found && visit(child)) found = true
    })
    return found
  }

  return visitFunction(applyNode)
}

const pluginShapeCache = new Map()

function pluginShape(source, file) {
  const cacheKey = `${file}\0${source}`
  const cached = pluginShapeCache.get(cacheKey)
  if (cached !== undefined) return cached
  const sourceFile = sourceFacts(source, file).sourceFile
  const bindings = new Map()
  const exports = new Map()
  const commonJs = new Map()
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const directExport = exportedModifier(statement)
      const constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        bindings.set(declaration.name.text, { kind: 'variable', constant, initializer: declaration.initializer, node: declaration })
        if (directExport) exports.set(declaration.name.text, declaration.name.text)
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      bindings.set(statement.name.text, { kind: 'function', constant: true, node: statement })
      if (exportedModifier(statement)) exports.set(statement.name.text, statement.name.text)
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exports.set(element.name.text, element.propertyName?.text ?? element.name.text)
    } else if (ts.isExpressionStatement(statement)
      && ts.isBinaryExpression(statement.expression)
      && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = commonJsExportName(statement.expression.left)
      if (name !== undefined) commonJs.set(name, statement.expression.right)
    }
  }
  const nameBinding = bindings.get(exports.get('name'))
  const nameInitializer = unwrapExpression(nameBinding?.initializer ?? commonJs.get('name'))
  const literalName = nameBinding?.constant === false ? undefined : literalSpecifier(nameInitializer)
  const applyExported = exports.has('apply') || commonJs.has('apply')
  const applyBinding = bindings.get(exports.get('apply'))
  const applyNode = functionNode(applyBinding?.kind === 'function' ? applyBinding.node : applyBinding?.initializer ?? commonJs.get('apply'), bindings)
  const injectExported = exports.has('inject') || commonJs.has('inject')
  const injectBinding = bindings.get(exports.get('inject'))
  const injectInitializer = injectBinding?.initializer ?? commonJs.get('inject')
  const shape = {
    literalName,
    apply: applyExported ? applyNode === undefined ? 'invalid' : 'valid' : 'absent',
    lifecycle: applyNode !== undefined && applyOwnsLifecycle(applyNode, bindings),
    inject: injectExported ? stableInjectInitializer(injectInitializer) ? 'valid' : 'invalid' : 'absent',
    pluginMarker: exports.has('name') || exports.has('apply') || commonJs.has('name') || commonJs.has('apply'),
  }
  pluginShapeCache.set(cacheKey, shape)
  return shape
}

function resolveRelativeImport(importer, specifier) {
  const base = resolve(importer, '..', specifier)
  const extension = extname(base)
  const stem = extension === '' ? base : base.slice(0, -extension.length)
  const declarationImporter = /\.d\.(?:c|m)?ts$/u.test(importer)
  const declarationCandidates = declarationImporter
    ? extension === '.mjs'
      ? [`${stem}.d.mts`, `${stem}.d.ts`]
      : extension === '.cjs'
        ? [`${stem}.d.cts`, `${stem}.d.ts`]
        : [`${stem}.d.ts`, `${stem}.d.mts`, `${stem}.d.cts`]
    : []
  const candidates = extension === ''
    ? [...declarationCandidates, base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.d.ts'), resolve(base, 'index.js'), resolve(base, 'index.ts')]
    : [...declarationCandidates, base]
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile())
}

function entryClosure(entryPath) {
  const closure = []
  const visited = new Set()
  const queue = [entryPath]
  while (queue.length > 0) {
    const file = queue.shift()
    if (file === undefined || visited.has(file) || !existsSync(file)) continue
    const packedPath = packageRelativePath(file)
    if (packedPath === undefined) {
      violate('package', 'PLUGIN_ENTRY_CLOSURE_ESCAPE', `public entry closure escapes the package root: ${file}`)
      continue
    }
    const identity = realpathSync(file)
    if (visited.has(identity)) continue
    visited.add(identity)
    closure.push(file)
    const source = readFileSync(file, 'utf8')
    const facts = sourceFacts(source, file)
    if (facts.diagnostics.length > 0) {
      const messages = facts.diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; ')
      violate('package', 'PLUGIN_ENTRY_SYNTAX_INVALID', `${packedPath} has invalid syntax: ${messages}`)
    }
    for (const load of facts.dynamicLoads) {
      violate('package', 'PLUGIN_DYNAMIC_IMPORT_UNANALYZABLE', `${packedPath} has a non-literal ${load.kind} at offset ${load.position}`)
    }
    const closureSpecifiers = [
      ...facts.moduleSpecifiers.filter(specifier => specifier.startsWith('.')),
      ...facts.referencePaths,
    ]
    for (const specifier of closureSpecifiers) {
      const dependency = resolveRelativeImport(file, specifier)
      if (dependency === undefined) {
        violate('package', 'PLUGIN_ENTRY_IMPORT_UNRESOLVED', `${packedPath} references missing relative target ${specifier}`)
      } else if (packageRelativePath(dependency) === undefined) {
        violate('package', 'PLUGIN_ENTRY_CLOSURE_ESCAPE', `${packedPath} imports a target outside the package: ${specifier}`)
      } else {
        queue.push(dependency)
      }
    }
    for (const specifier of facts.moduleSpecifiers) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(specifier) || specifier.startsWith('file:')) {
        violate('package', 'PLUGIN_ENTRY_CLOSURE_ESCAPE', `${packedPath} imports an absolute target outside the package: ${specifier}`)
        continue
      }
      if (specifier.startsWith('#')) {
        violate('package', 'PLUGIN_PACKAGE_IMPORTS_UNSUPPORTED', `${packedPath} uses package imports that cannot enter the public closure: ${specifier}`)
        continue
      }
      if (/^(?:data|https?):/u.test(specifier)) {
        violate('package', 'PLUGIN_ENTRY_IMPORT_UNSUPPORTED', `${packedPath} imports an unsupported URL module: ${specifier}`)
        continue
      }
      const key = selfReferenceExportKey(specifier)
      if (key === undefined) continue
      const selectedExport = exportValue(packageManifest.exports, key)
      if (selectedExport === undefined) {
        const pattern = exportedEntries(packageManifest.exports).find(([candidate]) => exportPatternMatches(candidate, key))?.[0]
        if (pattern === undefined) violate('package', 'PLUGIN_SELF_REFERENCE_NOT_EXPORTED', `${packedPath} imports an unexported self-reference: ${specifier}`)
        else violate('package', 'PLUGIN_SELF_REFERENCE_PATTERN_UNSUPPORTED', `${packedPath} self-reference ${specifier} resolves through unsupported export pattern ${pattern}`)
        continue
      }
      const runtimeTarget = exportTarget(selectedExport)
      const targets = declarationFile(file)
        ? declarationTargets(selectedExport, key, runtimeTarget)
        : runtimeTarget === undefined ? [] : [runtimeTarget]
      if (targets.length === 0) {
        violate('package', 'PLUGIN_SELF_REFERENCE_TARGET_INVALID', `${packedPath} self-reference has no inspectable target: ${specifier}`)
        continue
      }
      for (const target of targets) {
        const dependency = targetPath(target)
        if (dependency === undefined) {
          violate('package', 'PLUGIN_SELF_REFERENCE_TARGET_INVALID', `${packedPath} self-reference target is missing, non-file, or outside the package: ${specifier} -> ${target}`)
        } else {
          queue.push(dependency)
        }
      }
    }
  }
  return closure
}

function dependencyPackage(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function validateV1HostPeers() {
  const cordis = '@deepseek-ai/cordis'
  if (Object.hasOwn(packageManifest.dependencies ?? {}, cordis) || Object.hasOwn(packageManifest.optionalDependencies ?? {}, cordis)) {
    violate('package', 'PLUGIN_HOST_SINGLETON_DEPENDENCY_INVALID', `${cordis} is host-owned and must not be installed through dependencies or optionalDependencies`)
  }
  if (!Object.hasOwn(packageManifest.peerDependencies ?? {}, cordis)) {
    violate('package', 'PLUGIN_HOST_PEER_MISSING', `${cordis} must be declared in peerDependencies`)
  } else if (packageManifest.peerDependenciesMeta?.[cordis]?.optional === true) {
    violate('package', 'PLUGIN_HOST_PEER_OPTIONAL', `${cordis} is required by a Cordis plugin and must not be an optional peer`)
  } else {
    const range = packageManifest.peerDependencies[cordis]
    if (typeof range !== 'string' || validRange(range) === null) {
      violate('package', 'PLUGIN_HOST_PEER_RANGE_INVALID', `${cordis} peer range is invalid: ${String(range)}`)
    } else if (!intersects(range, '^4.0.1', { includePrerelease: true })) {
      violate('package', 'PLUGIN_HOST_PEER_RANGE_INCOMPATIBLE', `${cordis} peer range ${range} does not intersect the supported ^4.0.1 host line`)
    }
  }
}

function packedFileList() {
  const destination = mkdtempSync(join(tmpdir(), 'blue-plugin-validate-pack-'))
  try {
    const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const start = output.indexOf('[')
    if (start < 0) throw new Error('npm pack returned no JSON array')
    const packed = JSON.parse(output.slice(start))[0]
    if (!Array.isArray(packed?.files)) throw new Error('npm pack returned no file list')
    return new Set(packed.files.map(file => file.path))
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}

const exportsMap = packageManifest.exports
const filesWhitelist = packageManifest.files
let exportedTargetsPackSafe = true
if (exportsMap === undefined || exportsMap === null || typeof exportsMap !== 'object') {
  if (typeof exportsMap !== 'string') violate('package', 'PACKAGE_EXPORTS_MISSING', 'package exports map is missing')
}
if (!Array.isArray(filesWhitelist)) violate('package', 'PACKAGE_FILES_MISSING', 'package files whitelist is missing')

for (const [key, value] of exportedEntries(exportsMap)) {
  if (key.includes('*')) continue
  const target = exportTarget(value)
  if (target !== undefined) {
    const path = targetPath(target)
    if (!target.startsWith('./')) violate('package', 'PACKAGE_EXPORT_TARGET_INVALID', `export target must stay package-relative ${key}: ${target}`)
    else if (!existsSync(resolve(root, target))) violate('package', 'PACKAGE_EXPORT_TARGET_MISSING', `missing export target ${key}: ${target}`)
    else if (!lstatSync(resolve(root, target)).isFile()) violate('package', 'PACKAGE_EXPORT_TARGET_NOT_FILE', `export target is not a regular file ${key}: ${target}`)
    else if (path === undefined) violate('package', 'PACKAGE_EXPORT_TARGET_ESCAPE', `export target escapes the package root ${key}: ${target}`)
    if (path === undefined) exportedTargetsPackSafe = false
    if (target.replace(/^\.\//u, '').startsWith('lib/')
      && Array.isArray(filesWhitelist)
      && filesWhitelistCoverage(filesWhitelist, target) === false) {
      violate('package', 'PACKAGE_EXPORT_NOT_SHIPPED', `export target is not covered by files ${key}: ${target}`)
    }
  }
  for (const declaration of declarationTargets(value, key, target)) {
    const declarationPath = targetPath(declaration)
    if (!declaration.startsWith('./')) {
      violate('package', 'PACKAGE_EXPORT_TYPES_TARGET_INVALID', `types export target must stay package-relative ${key}: ${declaration}`)
    } else if (!existsSync(resolve(root, declaration))) {
      violate('package', 'PACKAGE_EXPORT_TYPES_TARGET_MISSING', `missing types export target ${key}: ${declaration}`)
    } else if (!lstatSync(resolve(root, declaration)).isFile()) {
      violate('package', 'PACKAGE_EXPORT_TYPES_TARGET_NOT_FILE', `types export target is not a regular file ${key}: ${declaration}`)
    } else if (declarationPath === undefined) {
      violate('package', 'PACKAGE_EXPORT_TYPES_TARGET_ESCAPE', `types export target escapes the package root ${key}: ${declaration}`)
    }
    if (declarationPath === undefined) exportedTargetsPackSafe = false
    if (Array.isArray(filesWhitelist) && filesWhitelistCoverage(filesWhitelist, declaration) === false) {
      violate('package', 'PACKAGE_EXPORT_TYPES_NOT_SHIPPED', `types export target is not covered by files ${key}: ${declaration}`)
    }
  }
}

const pointer = packageManifest.blue?.manifest
const manifestDiscovered = manifestCandidate
let distributionManifestValid = false
let inspectedFiles = sourceFiles

if (manifestDiscovered) {
  if (pointer !== './blue.plugin.json') {
    violate('package', 'PLUGIN_DISCOVERY_POINTER_INVALID', 'package.json.blue.manifest must equal ./blue.plugin.json')
  }
  if (!existsSync(canonicalDistributionManifestPath)) {
    violate('package', 'PLUGIN_MANIFEST_MISSING', 'package.json points to a missing blue.plugin.json')
  } else if (!lstatSync(canonicalDistributionManifestPath).isFile()) {
    violate('package', 'PLUGIN_MANIFEST_NOT_FILE', 'blue.plugin.json is not a regular package file')
  } else if (packageRelativePath(canonicalDistributionManifestPath) === undefined) {
    violate('package', 'PLUGIN_MANIFEST_ESCAPE', 'blue.plugin.json escapes the package root')
  } else {
    let distribution
    try {
      distribution = JSON.parse(readFileSync(canonicalDistributionManifestPath, 'utf8'))
    } catch {
      violate('package', 'PLUGIN_MANIFEST_INVALID_JSON', 'blue.plugin.json is not valid JSON')
    }
    if (distribution !== undefined) {
      if (distribution === null || typeof distribution !== 'object' || Array.isArray(distribution)) {
        violate('package', 'PLUGIN_MANIFEST_INVALID', 'blue.plugin.json must contain an object')
        distribution = undefined
      }
    }
    if (distribution !== undefined) {
      let manifest
      let target
      let selectedDeclarationTargets = []
      if (Object.hasOwn(distribution, '$schema')) {
        const parsed = protocol.validateBluePluginManifestV1(distribution)
        if (!parsed.ok) {
          for (const issue of parsed.issues) violate('package', issue.code, `${issue.path}: ${issue.message}`)
        } else {
          manifest = parsed.value
          validateV1HostPeers()
          const selectedExport = exportValue(exportsMap, manifest.entry)
          target = exportTarget(selectedExport)
          selectedDeclarationTargets = declarationTargets(selectedExport, manifest.entry, target)
          if (selectedExport === undefined) {
            violate('package', 'PLUGIN_ENTRY_NOT_EXPORTED', `manifest entry is not a package export: ${manifest.entry}`)
          } else if (target === undefined) {
            violate('package', 'PLUGIN_ENTRY_TARGET_INVALID', `manifest entry has no runtime target: ${manifest.entry}`)
          }
        }
      } else {
        const parsed = legacyProtocol.validateBlueManifest(distribution)
        if (!parsed.ok) {
          violate('package', parsed.code, parsed.message)
        } else {
          manifest = distribution
          target = distribution.entry
          if (typeof target !== 'string') violate('package', 'PLUGIN_ENTRY_TARGET_INVALID', 'legacy manifest entry must be a runtime path')
          const publicEntry = exportedEntries(exportsMap).find(([, value]) => exportTarget(value) === target)
          selectedDeclarationTargets = declarationTargets(publicEntry?.[1], publicEntry?.[0], target)
          if (publicEntry === undefined) violate('package', 'PLUGIN_ENTRY_NOT_EXPORTED', `legacy manifest entry is not a package export target: ${String(target)}`)
        }
      }

      if (manifest !== undefined) {
        distributionManifestValid = true
        if (manifest.id !== packageName) {
          violate('package', 'PLUGIN_ID_PACKAGE_MISMATCH', `manifest id ${manifest.id} does not match package name ${packageName}`)
        }
        if (typeof target === 'string') {
          const entryPath = resolve(root, target)
          if (!existsSync(entryPath)) {
            violate('package', 'PLUGIN_ENTRY_MISSING', `manifest entry target is missing: ${target}`)
            inspectedFiles = []
          } else if (!lstatSync(entryPath).isFile()) {
            violate('package', 'PLUGIN_ENTRY_NOT_FILE', `manifest entry target is not a regular file: ${target}`)
            inspectedFiles = []
          } else if (targetPath(target) === undefined) {
            violate('package', 'PLUGIN_ENTRY_ESCAPE', `manifest entry target escapes the package root: ${target}`)
            inspectedFiles = []
          } else {
            inspectedFiles = entryClosure(entryPath)
            for (const declarationTarget of selectedDeclarationTargets) {
              const declarationPath = targetPath(declarationTarget)
              if (declarationPath === undefined) continue
              for (const file of entryClosure(declarationPath)) {
                if (!inspectedFiles.includes(file)) inspectedFiles.push(file)
              }
            }
            const declaredDependencies = new Set(Object.keys({
              ...packageManifest.dependencies,
              ...packageManifest.peerDependencies,
              ...packageManifest.optionalDependencies,
            }))
            const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)])
            for (const file of inspectedFiles) {
              const source = readFileSync(file, 'utf8')
              for (const specifier of new Set(importSpecifiers(source, file))) {
                if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#') || builtins.has(specifier)) continue
                const dependency = dependencyPackage(specifier)
                if (dependency !== packageName && !declaredDependencies.has(dependency)) {
                  violate('package', 'PLUGIN_RUNTIME_DEPENDENCY_UNDECLARED', `${relative(root, file)} references undeclared public package ${dependency}`)
                }
              }
              for (const specifier of new Set(referenceTypeSpecifiers(source, file))) {
                const direct = dependencyPackage(specifier)
                if (direct === packageName) continue
                const typePackage = direct.startsWith('@types/')
                  ? direct
                  : direct.startsWith('@')
                    ? `@types/${direct.slice(1).replace('/', '__')}`
                    : `@types/${direct}`
                if (!declaredDependencies.has(direct) && !declaredDependencies.has(typePackage)) {
                  violate('package', 'PLUGIN_RUNTIME_DEPENDENCY_UNDECLARED', `${relative(root, file)} references undeclared type package ${specifier}; declare ${direct} or ${typePackage}`)
                }
              }
            }
          }

          if (Array.isArray(filesWhitelist) && filesWhitelistCoverage(filesWhitelist, target) === false) {
            violate('package', 'PLUGIN_ENTRY_NOT_SHIPPED', `manifest entry target is not covered by files: ${target}`)
          }
        } else {
          inspectedFiles = []
        }

        if (Array.isArray(filesWhitelist) && filesWhitelistCoverage(filesWhitelist, './blue.plugin.json') === false) {
          violate('package', 'PLUGIN_MANIFEST_NOT_SHIPPED', 'blue.plugin.json is not covered by package files')
        }

        if (exportedTargetsPackSafe) {
          try {
            const packed = packedFileList()
            if (!packed.has('blue.plugin.json')) violate('package', 'PLUGIN_MANIFEST_NOT_PACKED', 'npm pack omits blue.plugin.json')
            if (target !== undefined && !packed.has(target.replace(/^\.\//u, ''))) {
              violate('package', 'PLUGIN_ENTRY_NOT_PACKED', `npm pack omits manifest entry target: ${target}`)
            }
            for (const declarationTarget of selectedDeclarationTargets) {
              if (!packed.has(declarationTarget.replace(/^\.\//u, ''))) {
                violate('package', 'PLUGIN_ENTRY_TYPES_NOT_PACKED', `npm pack omits manifest entry types: ${declarationTarget}`)
              }
            }
            for (const [key, value] of exportedEntries(exportsMap)) {
              if (key.includes('*')) continue
              const runtimeTarget = exportTarget(value)
              for (const exportedTarget of [runtimeTarget, ...declarationTargets(value, key, runtimeTarget)]) {
                if (exportedTarget !== undefined && !packed.has(exportedTarget.replace(/^\.\//u, ''))) {
                  violate('package', 'PACKAGE_EXPORT_NOT_PACKED', `npm pack omits export ${key}: ${exportedTarget}`)
                }
              }
            }
            for (const file of inspectedFiles) {
              const path = packageRelativePath(file)
              if (path !== undefined && !packed.has(path)) {
                violate('package', 'PLUGIN_ENTRY_CLOSURE_NOT_PACKED', `npm pack omits public entry closure file: ${path}`)
              }
            }
          } catch (error) {
            violate('package', 'PACKAGE_PACK_FAILED', error instanceof Error ? error.message : String(error))
          }
        }
      }
    }
  }
} else if (sourceFiles.length === 0) {
  violate('package', 'PACKAGE_SOURCE_MISSING', 'src contains no executable source files and no Blue manifest is declared')
}

const sourceEntries = inspectedFiles.map(file => {
  const source = readFileSync(file, 'utf8')
  return { file, source, shape: pluginShape(source, file) }
})
const pluginEntries = manifestDiscovered
  ? sourceEntries.slice(0, 1)
  : sourceEntries.filter(entry => entry.shape.pluginMarker && !/(?:^|[\\/])invariant\.(?:mjs|cjs|js|ts)$/u.test(entry.file))
for (const entry of pluginEntries) {
  if (entry.shape.literalName === undefined) violate('package', 'PLUGIN_NAME_UNSTABLE', `plugin entry does not export a literal const name: ${relative(root, entry.file)}`)
  if (entry.shape.apply === 'absent') violate('package', 'PLUGIN_APPLY_MISSING', `plugin entry does not export apply: ${relative(root, entry.file)}`)
  if (entry.shape.apply === 'invalid') violate('package', 'PLUGIN_APPLY_INVALID', `plugin entry apply export is not statically callable: ${relative(root, entry.file)}`)
  if (entry.shape.inject === 'invalid') violate('package', 'PLUGIN_INJECT_INVALID', `plugin inject must be a stable array: ${relative(root, entry.file)}`)
}

const isCore = /packages[\\/]core(?:[\\/]|$)/u.test(root)
for (const file of inspectedFiles) {
  const source = readFileSync(file, 'utf8')
  const label = relative(root, file)
  const facts = sourceFacts(source, file)
  const publicSpecifiers = [...facts.moduleSpecifiers, ...facts.referenceTypes]
  const rendererNeutral = manifestDiscovered || /(?:frontend|adapter|context|remote|openpencil|lark)/iu.test(root)
  if (!isCore && rendererNeutral && (facts.rawTerminal || publicSpecifiers.some(specifier => dependencyPackage(specifier) === '@earendil-works/pi-tui'))) {
    violate('architecture', 'ARCH_RENDERER_BOUNDARY', `renderer or raw-terminal dependency outside core: ${label}`)
  }
  const rendererDependency = publicSpecifiers.some(specifier => /(?:^|[\/@_-])(?:react(?:-dom)?|jsdom|dom|ansi)(?:$|[\/@_.-])/iu.test(dependencyPackage(specifier)))
  const domLib = facts.referenceLibs.some(reference => /^dom(?:\.|$)/iu.test(reference))
  if (!isCore && rendererNeutral && (rendererDependency || domLib || facts.rendererGlobal || facts.ansi)) {
    violate('architecture', 'ARCH_RENDERER_PUBLIC_API', `renderer-specific dependency in frontend entry: ${label}`)
  }
  if (rendererNeutral && publicSpecifiers.some(specifier => /^@deepseek-ai\/dsh-(?:agent|session)$/u.test(dependencyPackage(specifier)))) {
    violate('architecture', 'ARCH_DOMAIN_OBJECT_IMPORT', `Agent or Session package referenced across the renderer-neutral boundary: ${label}`)
  }
  if (rendererNeutral && facts.sessionEventFolding) {
    violate('architecture', 'ARCH_SESSION_EVENT_FOLDING', `frontend entry appears to fold Harness session events: ${label}`)
  }
}

const lifecycle = manifestDiscovered
  ? pluginEntries.some(entry => entry.shape.lifecycle)
  : inspectedFiles.some(file => sourceFacts(readFileSync(file, 'utf8'), file).lifecycle)
if (pluginEntries.length > 0 && !lifecycle) violate('lifecycle', 'LIFECYCLE_OWNERSHIP_MISSING', 'plugin entry has no observable Fiber lifecycle or registry ownership marker')

const groups = { package: 0, architecture: 0, lifecycle: 0 }
for (const violation of violations) groups[violation.group] += 1
const report = {
  package: packageName,
  root,
  valid: violations.length === 0,
  files: inspectedFiles.length,
  lifecycle,
  manifest: { discovered: manifestDiscovered, valid: distributionManifestValid },
  groups,
  violations,
}
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.valid ? 0 : 1
