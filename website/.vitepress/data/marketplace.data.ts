// 市场数据加载器（构建期 Node 执行，结果序列化为 JSON 供组件消费）。
// 数据来源是 script/marketplace-fetch.mjs 拷入的 marketplace 仓生成物；
// 本地未拉取数据时返回 available:false 降级（页面渲染提示，不炸构建）。
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface MarketplaceInstall {
  kind: 'github' | 'git' | 'npm' | 'tarball'
  spec: string
}

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
      const plugins: MarketplaceEntry[] = Array.isArray(registry?.plugins) ? registry.plugins : []
      return { available: true, plugins, categories }
    } catch {
      return { available: false, plugins: [], categories: [] }
    }
  },
}
