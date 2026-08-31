// 市场数据加载器（构建期 Node 执行，结果序列化为 JSON 供组件消费）。
// 数据来源是 script/marketplace-fetch.mjs 拷入的 marketplace 仓生成物；
// 本地未拉取数据时返回 available:false 降级（页面渲染提示，不炸构建）。
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface MarketplaceInstall {
  kind: 'github' | 'git' | 'npm' | 'tarball'
  spec: string
}

// 收录状态：verified 通过兼容性验证（/plugin 可装）、unverified 仅 CLI 可装、
// adapting 正与开发者合作适配当前 Harness 线。registry 未迁移前可省略，
// 由 load() 从旧 verified 布尔推导。
export type MarketplaceStatus = 'verified' | 'unverified' | 'adapting'

export interface MarketplaceEntry {
  id: string
  package: string
  version: string
  title: { zh: string; en: string }
  tagline: { zh: string; en: string }
  author: string
  repo: string
  install: MarketplaceInstall[]
  capabilities: string[]
  categories: string[]
  license: string
  verified: boolean
  status: MarketplaceStatus
  // 适配中条目的跟踪 issue URL（与开发者合作的适配进度），无则为 null
  adaptingIssue: string | null
  npm: string | null
  image: string | null
  added: string
}

export interface MarketplaceCategory {
  id: string
  zh: string
  en: string
}

export interface MarketplaceData {
  available: boolean
  plugins: MarketplaceEntry[]
  categories: MarketplaceCategory[]
}

declare const data: MarketplaceData
export { data }

const DATA_DIR = fileURLToPath(new URL('../marketplace-data/', import.meta.url))

export default {
  watch: ['../marketplace-data/*.json'],
  load(): MarketplaceData {
    const registryFile = `${DATA_DIR}registry.json`
    const categoriesFile = `${DATA_DIR}categories.json`
    if (!existsSync(registryFile) || !existsSync(categoriesFile)) {
      return { available: false, plugins: [], categories: [] }
    }
    try {
      const registry = JSON.parse(readFileSync(registryFile, 'utf8'))
      const categories: MarketplaceCategory[] = JSON.parse(readFileSync(categoriesFile, 'utf8'))
      const raw: MarketplaceEntry[] = Array.isArray(registry?.plugins) ? registry.plugins : []
      // 归一化：registry 尚未带 status 字段时按旧 verified 布尔推导，
      // 保证组件拿到的每条 entry 状态确定。
      const plugins = raw.map((p) => ({
        ...p,
        status: p.status ?? (p.verified ? 'verified' : 'unverified'),
        adaptingIssue: p.adaptingIssue ?? null,
      }))
      return { available: true, plugins, categories }
    } catch {
      return { available: false, plugins: [], categories: [] }
    }
  },
}
