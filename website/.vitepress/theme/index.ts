import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'

// 粘性语言切换（ADR D32）：head 内联脚本负责整页加载时的自动分流且不写偏好；
// 这里在 SPA 导航（含手动切换语言）时把落点 locale 盖章为偏好，此后自动分流
// 不再与用户的选择打架（双向粘性）。
const PREF_KEY = 'dsh-blue-docs-lang'

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (typeof window === 'undefined') return
    // 注意必须先剥 Vite base（Pages 下为 /blue/）再判 locale，
    // 否则所有导航都会被误判为根路径语言（中文）。
    const base = import.meta.env.BASE_URL || '/'
    const stamp = (to: string) => {
      let rest = to
      if (base !== '/' && rest.startsWith(base)) rest = rest.slice(base.length)
      rest = rest.replace(/\.html$/, '').replace(/^\/+|\/+$/g, '')
      const lang = rest === 'en' || rest.startsWith('en/') ? 'en' : 'zh'
      try { localStorage.setItem(PREF_KEY, lang) } catch {}
    }
    router.onBeforeRouteChange = (to) => {
      stamp(to)
      return true
    }
  },
} satisfies Theme
