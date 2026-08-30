#!/usr/bin/env node
// 从 dsh-blue/marketplace 拉取插件市场数据，拷贝为网站的 untracked 生成物：
//   registry.json / categories.json      → website/.vitepress/marketplace-data/
//   content/<id>/zh.md                   → website/marketplace/<id>/index.md
//   content/<id>/en.md                   → website/en/marketplace/<id>/index.md
//   content/<id>/assets/**               → 两侧同名 assets/
// 手写的 website/marketplace/index.md、submit.md 永不触碰；仅按 manifest
// 清理上一轮生成的插件目录（防下架插件残留成死路由）。
//
// 用法：node script/marketplace-fetch.mjs [--ref <ref>] [--allow-missing] [--force] [--paused]
//   --ref           marketplace 仓库的分支/标签，默认 master
//   --allow-missing 拿不到数据时不报错（本地 dev 降级用；CI 不带此参数）
//   --force         忽略缓存重新 clone
//   --paused        迁移期不取数，并清理上轮生成的数据与详情路由
// 环境变量 MARKETPLACE_REPO 可覆盖源（默认 GitHub；本地联调指向本地路径）。
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.MARKETPLACE_REPO ?? 'https://github.com/dsh-blue/marketplace.git'
const CACHE = join(repoRoot, '.marketplace-cache')
const DATA_DIR = join(repoRoot, 'website/.vitepress/marketplace-data')
const SIDES = [
  { lang: 'zh', base: join(repoRoot, 'website/marketplace') },
  { lang: 'en', base: join(repoRoot, 'website/en/marketplace') },
]
const MANIFEST = join(DATA_DIR, '.generated.json')
// 与网站手写页面冲突的保留 id（marketplace 仓校验脚本同款清单）
const RESERVED = new Set(['submit'])

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const REF = opt('--ref') ?? 'master'
const ALLOW_MISSING = flag('--allow-missing')

const fail = (msg) => { console.error(`✖ marketplace-fetch：${msg}`); process.exit(1) }
const git = (args_, opts = {}) => spawnSync('git', args_, { encoding: 'utf8', ...opts })
// git 的 stderr 首行常是 "Cloning into '.'..." 之类的噪音，取最后一条实质信息
const lastLine = (s) => (s || '').trim().split('\n').filter(Boolean).pop() ?? ''

// P1-P4 migration gate: keep the hand-written status/submission pages while
// removing every fetched plugin route and data file from Website builds.
if (flag('--paused')) {
  rmSync(DATA_DIR, { recursive: true, force: true })
  for (const { base } of SIDES) {
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) rmSync(join(base, entry.name), { recursive: true, force: true })
    }
  }
  console.log('✓ marketplace-fetch：迁移暂停，已清理生成数据与详情路由')
  process.exit(0)
}

// ── 1. 取数：clone / fetch，失败时降级用旧缓存 ──────────────────────────────
if (flag('--force') && existsSync(CACHE)) rmSync(CACHE, { recursive: true, force: true })

const cacheHasData = () => existsSync(join(CACHE, 'registry.json'))

if (!cacheHasData()) {
  mkdirSync(CACHE, { recursive: true })
  const r = git(['clone', '--depth', '1', '--branch', REF, SRC, '.'], { cwd: CACHE })
  if (r.status !== 0) {
    rmSync(CACHE, { recursive: true, force: true })
    if (ALLOW_MISSING) {
      console.warn('⚠ marketplace-fetch：无法获取数据（--allow-missing，跳过）')
      process.exit(0)
    }
    fail(`clone ${SRC}@${REF} 失败：${lastLine(r.stderr) || lastLine(r.stdout)}`)
  }
} else {
  const fetch = git(['fetch', '--depth', '1', 'origin', REF], { cwd: CACHE })
  const reset = fetch.status === 0 ? git(['reset', '--hard', 'FETCH_HEAD'], { cwd: CACHE }) : fetch
  if (reset.status !== 0) {
    if (cacheHasData()) console.warn(`⚠ marketplace-fetch：更新失败，沿用缓存（${(fetch.stderr || '').trim().split('\n').pop()}）`)
    else if (ALLOW_MISSING) { console.warn('⚠ marketplace-fetch：缓存无效且无法获取数据（--allow-missing，跳过）'); process.exit(0) }
    else fail(`fetch ${SRC}@${REF} 失败：${(fetch.stderr || '').split('\n')[0]}`)
  }
}

// ── 2. 交叉校验（拷贝前全查一遍，杜绝半拷贝）───────────────────────────────
const errors = []
let registry
try {
  registry = JSON.parse(readFileSync(join(CACHE, 'registry.json'), 'utf8'))
} catch (e) {
  errors.push(`registry.json 无法解析：${e.message}`)
}
const plugins = Array.isArray(registry?.plugins) ? registry.plugins : []
if (!plugins.length) errors.push('registry.json 中没有任何插件条目')

const ids = new Set()
for (const e of plugins) {
  if (typeof e?.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(e.id)) { errors.push(`条目 id 非法：${JSON.stringify(e?.id)}`); continue }
  if (RESERVED.has(e.id)) errors.push(`id ${e.id} 是保留字，会与网站手写页面冲突`)
  if (ids.has(e.id)) errors.push(`id 重复：${e.id}`)
  ids.add(e.id)
  for (const lang of ['zh', 'en']) {
    const f = join(CACHE, 'content', e.id, `${lang}.md`)
    if (!existsSync(f) || !readFileSync(f, 'utf8').trim()) errors.push(`条目 ${e.id} 缺少 content/${e.id}/${lang}.md`)
  }
}
const contentRoot = join(CACHE, 'content')
if (existsSync(contentRoot)) {
  for (const name of readdirSync(contentRoot)) {
    if (statSync(join(contentRoot, name)).isDirectory() && !ids.has(name)) errors.push(`content/${name}/ 无对应 registry 条目`)
  }
}
if (errors.length) fail(`数据校验未过（${errors.length} 处）：\n  ${errors.join('\n  ')}`)

// ── 3. 拷贝 ────────────────────────────────────────────────────────────────
mkdirSync(DATA_DIR, { recursive: true })
for (const f of ['registry.json', 'categories.json']) {
  if (existsSync(join(CACHE, f))) cpSync(join(CACHE, f), join(DATA_DIR, f))
}

// 清理上一轮生成、本轮已下架的插件目录（按 manifest，不误伤手写内容）
const prevGenerated = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : []
for (const id of prevGenerated) {
  if (ids.has(id)) continue
  for (const { base } of SIDES) rmSync(join(base, id), { recursive: true, force: true })
  console.log(`  - 移除已下架插件目录：${id}`)
}

for (const { base } of SIDES) mkdirSync(base, { recursive: true })
for (const id of ids) {
  for (const { lang, base } of SIDES) {
    const dir = join(base, id)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    cpSync(join(CACHE, 'content', id, `${lang}.md`), join(dir, 'index.md'))
    const assets = join(CACHE, 'content', id, 'assets')
    if (existsSync(assets)) cpSync(assets, join(dir, 'assets'), { recursive: true })
  }
}
writeFileSync(MANIFEST, JSON.stringify([...ids], null, 2) + '\n')

const sha = git(['rev-parse', '--short', 'HEAD'], { cwd: CACHE, encoding: 'utf8' })
console.log(`✓ marketplace-fetch：${plugins.length} 个插件 @ ${SRC.split('/').pop().replace('.git', '')}@${REF}${sha.status === 0 ? `(${sha.stdout.trim()})` : ''}`)
