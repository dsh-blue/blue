<script setup lang="ts">
// 市场插件卡片：整卡可点进详情页（stretch-link 覆盖层实现），
// GitHub 外链与安装命令条 zIndex 更高，其点击不会触发跳转。
// 收录状态三档：verified（已验证，/plugin 可装）、unverified（未验证，CLI 可装
// 但不保证兼容）、adapting（适配中，不提供安装动作）。
import { computed } from 'vue'
import { withBase } from 'vitepress'
import type { MarketplaceEntry, MarketplaceCategory, MarketplaceStatus } from '../../data/marketplace.data'
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

const statusMeta = computed<Record<MarketplaceStatus, { label: string, title: string }>>(() =>
  props.lang === 'en'
    ? {
        verified: { label: 'Verified', title: 'Verified by maintainers; installable from the /plugin panel' },
        unverified: { label: 'Unverified', title: 'Installable via CLI; full compatibility not guaranteed' },
        adapting: { label: 'Adapting', title: 'Working with the author on Harness-line compatibility' },
      }
    : {
        verified: { label: '已验证', title: '维护者已验证；可在 /plugin 面板一键安装' },
        unverified: { label: '未验证', title: '可通过 CLI 安装；不保证完全兼容' },
        adapting: { label: '适配中', title: '正与开发者合作适配当前 Harness 线' },
      })
const status = computed(() => statusMeta.value[props.plugin.status])
const installHint = computed(() => {
  if (props.plugin.status === 'verified')
    return props.lang === 'en' ? 'Also one-click installable in the TUI /plugin panel' : '也可在 TUI /plugin 面板一键安装'
  if (props.plugin.status === 'unverified')
    return props.lang === 'en' ? 'Installable via CLI — full compatibility not guaranteed' : '可通过 CLI 安装，不保证完全兼容'
  return props.lang === 'en'
    ? 'Adapting to the current Harness line with the author — install is not offered yet'
    : '正与开发者合作适配当前 Harness 线，暂不提供安装'
})
// 适配中卡片：跟踪 issue 链接，展示文字尽量带 issue 编号
const issueLabel = computed(() => {
  const url = props.plugin.adaptingIssue
  if (!url) return ''
  const num = url.match(/\/issues\/(\d+)/)?.[1]
  const base = props.lang === 'en' ? 'Track adaptation progress' : '跟踪适配进度'
  return num ? `${base} · issue #${num} →` : `${base} →`
})
</script>

<template>
  <article class="card">
    <div class="head">
      <a class="title-link" :href="href">
        <span class="title">{{ title }}</span>
      </a>
      <span class="badge" :class="`badge-${plugin.status}`" :title="status.title">
        <svg v-if="plugin.status === 'verified'" aria-hidden viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
          <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
        </svg>
        {{ status.label }}
      </span>
      <span class="spacer" />
      <a class="repo-link" :href="plugin.repo" target="_blank" rel="noopener" :title="plugin.repo">
        <svg aria-hidden viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
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
      <InstallCommand v-if="plugin.status !== 'adapting'" :command="installCommand" wrap />
      <a
        v-if="plugin.status === 'adapting' && plugin.adaptingIssue"
        class="issue-link"
        :href="plugin.adaptingIssue"
        target="_blank"
        rel="noopener"
      >{{ issueLabel }}</a>
      <p class="install-hint" :class="{ adapting: plugin.status === 'adapting' }">{{ installHint }}</p>
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
}
.badge-verified {
  color: var(--vp-c-green-1);
  background: var(--vp-c-green-soft);
  border: 1px solid var(--vp-c-green-2);
}
.badge-unverified {
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
}
.badge-adapting {
  color: var(--vp-c-brand-1, var(--vp-c-brand));
  background: var(--vp-c-brand-soft, var(--vp-c-bg));
  border: 1px solid var(--vp-c-brand-2, var(--vp-c-brand));
}
/* GitHub 外链压在 stretch-link 之上，点击不触发跳转 */
.repo-link {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex-shrink: 0;
  color: var(--vp-c-text-3);
}
.repo-link:hover {
  color: var(--vp-c-text-1);
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
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.install-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-3);
}
.install-hint.adapting {
  color: var(--vp-c-brand-1, var(--vp-c-brand));
}
.issue-link {
  align-self: flex-start;
  padding: 4px 10px;
  border: 1px solid var(--vp-c-brand-2, var(--vp-c-brand));
  border-radius: 8px;
  background: var(--vp-c-brand-soft, var(--vp-c-bg));
  color: var(--vp-c-brand-1, var(--vp-c-brand));
  font-size: 12.5px;
  font-weight: 500;
  text-decoration: none;
}
.issue-link:hover {
  color: var(--vp-c-brand-2, var(--vp-c-brand));
}
</style>
