<script setup lang="ts">
// 市场插件卡片：整卡可点进详情页（stretch-link 覆盖层实现），
// 安装命令条 zIndex 更高，复制按钮的点击不会触发跳转。
import { computed } from 'vue'
import { withBase } from 'vitepress'
import type { MarketplaceEntry, MarketplaceCategory } from '../../data/marketplace.data'
import InstallCommand from './InstallCommand.vue'

const props = defineProps<{
  plugin: MarketplaceEntry
  categories: MarketplaceCategory[]
  lang: 'zh' | 'en'
}>()

const pick = (obj: { zh?: string; en?: string }) =>
  obj?.[props.lang] || obj?.zh || obj?.en || ''

const title = computed(() => pick(props.plugin.title))
const tagline = computed(() => pick(props.plugin.tagline))
const href = computed(() =>
  withBase(`${props.lang === 'en' ? '/en' : ''}/marketplace/${props.plugin.id}/`))
const categoryLabels = computed(() =>
  props.categories
    .filter((c) => props.plugin.categories.includes(c.id))
    .map((c) => (props.lang === 'en' ? c.en : c.zh)))
const installCommand = computed(() =>
  `blue plugin add ${props.plugin.install[0]?.spec ?? ''}`)
</script>

<template>
  <article class="card">
    <div class="head">
      <a class="title-link" :href="href">
        <span class="title">{{ title }}</span>
        <span v-if="plugin.verified" class="badge" :title="lang === 'en' ? 'Verified by maintainers' : '维护者已验证'">
          <svg aria-hidden viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
          </svg>
          {{ lang === 'en' ? 'Verified' : '已验证' }}
        </span>
      </a>
      <span class="version">v{{ plugin.version }}</span>
    </div>

    <p class="tagline">{{ tagline }}</p>

    <div class="meta">
      <span class="author">{{ plugin.author }}</span>
      <span v-for="c in categoryLabels" :key="c" class="cat">{{ c }}</span>
      <span class="spacer" />
      <span v-for="cap in plugin.capabilities" :key="cap" class="cap">{{ cap }}</span>
    </div>

    <div class="install">
      <InstallCommand :command="installCommand" wrap />
    </div>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.2s;
}
.card:hover {
  border-color: var(--vp-c-brand);
}
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.title-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  /* stretch link：覆盖层铺满整卡，整卡可点 */
}
.title-link::after {
  content: '';
  position: absolute;
  inset: 0;
}
.title {
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--vp-c-green-1);
  background: var(--vp-c-green-soft);
  border: 1px solid var(--vp-c-green-2);
}
.version {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}
.tagline {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.9em;
}
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.author {
  color: var(--vp-c-text-2);
}
.cat {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg);
}
.cap {
  font-family: var(--vp-font-family-mono);
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}
.spacer {
  flex: 1;
}
/* 安装命令条压在 stretch-link 之上，复制可点、不触发跳转 */
.install {
  position: relative;
  z-index: 1;
  margin-top: auto;
}
</style>
