<script setup lang="ts">
// 详情页元信息：从注册表按 id 渲染（版本/license/仓库等不手抄，改 registry 即全站同步）。
// id 打错时渲染灰字占位，避免外部内容打错字导致静默空白。
import { computed } from 'vue'
import { useData } from 'vitepress'
import { data } from '../../data/marketplace.data'

const props = defineProps<{ id: string }>()

const { localeIndex } = useData()
const lang = computed<'zh' | 'en'>(() => (localeIndex.value === 'en' ? 'en' : 'zh'))
const entry = computed(() => data.plugins.find((p) => p.id === props.id))

const label = computed<Record<string, string>>(() =>
  lang.value === 'en'
    ? {
        heading: 'Details',
        version: 'Version',
        license: 'License',
        repo: 'Repository',
        capabilities: 'Capabilities',
        categories: 'Categories',
        npm: 'npm',
        added: 'Listed',
        notPublished: 'Not published to npm',
        missing: `No registry entry found for id "${props.id}"`,
      }
    : {
        heading: '信息',
        version: '版本',
        license: '许可证',
        repo: '仓库',
        capabilities: '能力',
        categories: '分类',
        npm: 'npm',
        added: '收录日期',
        notPublished: '未发布 npm 包',
        missing: `registry 中未找到 id 为 "${props.id}" 的条目`,
      })

const categoryLabels = computed(() =>
  data.categories
    .filter((c) => entry.value?.categories.includes(c.id))
    .map((c) => (lang.value === 'en' ? c.en : c.zh)))
</script>

<template>
  <div v-if="entry" class="plugin-meta">
    <p class="heading">{{ label.heading }}</p>
    <dl>
      <div class="row">
        <dt>{{ label.version }}</dt>
        <dd><code>v{{ entry.version }}</code></dd>
      </div>
      <div class="row">
        <dt>{{ label.license }}</dt>
        <dd>{{ entry.license }}</dd>
      </div>
      <div class="row">
        <dt>{{ label.repo }}</dt>
        <dd>
          <a :href="entry.repo" target="_blank" rel="noopener">{{ entry.repo.replace('https://github.com/', '') }}</a>
        </dd>
      </div>
      <div class="row">
        <dt>{{ label.capabilities }}</dt>
        <dd><code v-for="c in entry.capabilities" :key="c" class="cap">{{ c }}</code></dd>
      </div>
      <div class="row">
        <dt>{{ label.categories }}</dt>
        <dd>{{ categoryLabels.join(' / ') }}</dd>
      </div>
      <div class="row">
        <dt>{{ label.npm }}</dt>
        <dd>{{ entry.npm ? entry.npm : label.notPublished }}</dd>
      </div>
      <div class="row">
        <dt>{{ label.added }}</dt>
        <dd>{{ entry.added }}</dd>
      </div>
    </dl>
  </div>
  <p v-else class="missing">{{ label.missing }}</p>
</template>

<style scoped>
.plugin-meta {
  margin: 28px 0 0;
  padding-top: 18px;
  border-top: 1px solid var(--vp-c-divider);
}
.heading {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-3);
}
dl {
  margin: 0;
  display: grid;
  gap: 6px;
}
.row {
  display: flex;
  gap: 12px;
  font-size: 13.5px;
  line-height: 1.6;
}
dt {
  flex-shrink: 0;
  width: 7.5em;
  color: var(--vp-c-text-3);
}
dd {
  margin: 0;
  color: var(--vp-c-text-2);
  min-width: 0;
  overflow-wrap: anywhere;
}
dd a {
  color: var(--vp-c-brand);
  text-decoration: none;
}
dd a:hover {
  text-decoration: underline;
}
code.cap {
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  font-size: 12px;
}
.missing {
  margin: 24px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
}
</style>
