<script setup lang="ts">
// 市场列表：搜索 + 分类筛选 + 卡片网格。数据来自 data loader（构建期生成），
// 双语字段按当前 locale 取值，缺失回退另一语言。
import { computed, ref } from 'vue'
import { useData } from 'vitepress'
import { data } from '../../data/marketplace.data'
import MarketplaceCard from './MarketplaceCard.vue'

const { localeIndex } = useData()
const lang = computed<'zh' | 'en'>(() => (localeIndex.value === 'en' ? 'en' : 'zh'))
const t = computed(() =>
  lang.value === 'en'
    ? {
        count: (n: number) => `${n} plugin${n === 1 ? '' : 's'}`,
        verified: (n: number) => `${n} verified`,
        search: 'Search by name, author, or package…',
        all: 'All',
        missing: 'Marketplace data not synced',
        missingHint: 'Run pnpm marketplace:fetch locally and reload (production builds fetch automatically).',
        empty: 'Nothing listed yet',
        emptyHint: 'Yours could be the first — see the submission guide.',
        emptyCta: 'Submit a plugin',
      }
    : {
        count: (n: number) => `共 ${n} 个插件`,
        verified: (n: number) => `已验证 ${n}`,
        search: '按名称、作者或包名搜索…',
        all: '全部',
        missing: '市场数据未同步',
        missingHint: '本地运行 pnpm marketplace:fetch 后刷新（生产构建会自动拉取）。',
        empty: '暂无收录',
        emptyHint: '第一个被收录的可能就是你。',
        emptyCta: '提交插件',
      })

const query = ref('')
const activeCategory = ref<string | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return data.plugins.filter((p) => {
    if (activeCategory.value && !p.categories.includes(activeCategory.value)) return false
    if (!q) return true
    const hay = [
      p.id, p.package, p.author,
      p.title.zh, p.title.en, p.tagline.zh, p.tagline.en,
      ...p.categories,
    ].join('\n').toLowerCase()
    return hay.includes(q)
  })
})
const verifiedCount = computed(() => data.plugins.filter((p) => p.verified).length)
const catLabel = (id: string) => {
  const c = data.categories.find((c) => c.id === id)
  return c ? (lang.value === 'en' ? c.en : c.zh) : id
}
</script>

<template>
  <!-- 数据未同步：本地未拉取时的降级提示（CI 为严格模式，生产不会出现） -->
  <div v-if="!data.available" class="notice">
    <p class="notice-title">{{ t.missing }}</p>
    <p class="notice-hint">{{ t.missingHint }}</p>
  </div>

  <template v-else>
    <div class="toolbar">
      <span class="stats">{{ t.count(data.plugins.length) }} · {{ t.verified(verifiedCount) }}</span>
      <input
        v-model="query"
        type="search"
        class="search"
        :placeholder="t.search"
        :aria-label="t.search"
      >
      <div class="chips" role="group" :aria-label="lang === 'en' ? 'Categories' : '分类'">
        <button
          type="button"
          class="chip"
          :class="{ active: activeCategory === null }"
          @click="activeCategory = null"
        >{{ t.all }}</button>
        <button
          v-for="c in data.categories"
          :key="c.id"
          type="button"
          class="chip"
          :class="{ active: activeCategory === c.id }"
          @click="activeCategory = activeCategory === c.id ? null : c.id"
        >{{ catLabel(c.id) }}</button>
      </div>
    </div>

    <div v-if="filtered.length" class="grid">
      <MarketplaceCard
        v-for="p in filtered"
        :key="p.id"
        :plugin="p"
        :categories="data.categories"
        :lang="lang"
      />
    </div>

    <div v-else class="notice">
      <p class="notice-title">{{ t.empty }}</p>
      <p class="notice-hint">
        {{ t.emptyHint }}
        <a :href="lang === 'en' ? '/en/marketplace/submit' : '/marketplace/submit'">{{ t.emptyCta }} →</a>
      </p>
    </div>
  </template>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 20px 0 16px;
}
.stats {
  font-size: 13px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}
.search {
  flex: 1;
  min-width: 200px;
  max-width: 340px;
  padding: 7px 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
}
.search:focus {
  border-color: var(--vp-c-brand);
  outline: none;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 4px 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 12.5px;
  cursor: pointer;
}
.chip:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
}
.chip.active {
  color: var(--vp-c-brand);
  border-color: var(--vp-c-brand);
  background: var(--vp-c-brand-dim, var(--vp-c-bg-soft));
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.notice {
  margin: 24px 0;
  padding: 18px 20px;
  border: 1px dashed var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}
.notice-title {
  margin: 0 0 6px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.notice-hint {
  margin: 0;
  font-size: 13.5px;
  color: var(--vp-c-text-2);
}
</style>
