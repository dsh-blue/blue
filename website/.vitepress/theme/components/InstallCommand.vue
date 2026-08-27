<script setup lang="ts">
// 与全站 fenced bash 代码块完全同构：复用主题的 language-bash DOM 结构与
// 类名，块外观、暗色切换、右上角 bash 标签与复制按钮全部由主题样式接管；
// 复制交互走主题的全局 click 代理（vitepress copyCode.js 匹配
// div[class*="language-"] > button.copy），本组件自身零 JS、SSR 安全。
// wrap=true 用于列表页卡片：窄列允许折行、去外边距、复制按钮常显（触屏可发现）。
import { computed } from 'vue'

const props = defineProps<{ command: string; wrap?: boolean }>()

// shiki(github-light/dark) 对 bash 的着色实际只有两档：命令名（紫）与其余实参（蓝）
const tokens = computed(() => {
  const m = props.command.match(/^(\S+)([\s\S]*)$/)!
  return [
    { text: m[1], style: { '--shiki-light': '#6F42C1', '--shiki-dark': '#B392F0' } },
    { text: m[2], style: { '--shiki-light': '#032F62', '--shiki-dark': '#9ECBFF' } },
  ]
})
</script>

<template>
  <div class="language-bash vp-adaptive-theme mp-install" :class="{ wrap: props.wrap }">
    <button title="Copy Code" class="copy"></button>
    <span class="lang">bash</span>
    <pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span
      v-for="(t, i) in tokens"
      :key="i"
      :style="t.style"
    >{{ t.text }}</span></span></code></pre>
  </div>
</template>

<style scoped>
/* 卡片场景的微调：其余全部继承主题的 fenced 块样式 */
.mp-install.wrap {
  margin: 0;
}
.mp-install.wrap pre,
.mp-install.wrap code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mp-install.wrap .copy {
  opacity: 1;
}
</style>
