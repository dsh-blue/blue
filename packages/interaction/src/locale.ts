/**
 * Interaction-owned locale catalog and lifecycle helpers. English source
 * strings double as stable keys, keeping command/domain identifiers outside
 * the translation boundary.
 *
 * @module @dsh-blue/blue-interaction/locale
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  interpolateLocaleMessage,
  type BlueLocaleCatalog,
  type BlueLocaleSnapshot,
  type BlueTranslate,
} from '@dsh-blue/blue-frontend'

const zh: Readonly<Record<string, string>> = {
  'tabs': '标签',
  'actions': '操作',
  'options': '选项',
  'fields': '字段',
  'groups': '分组',
  'rows': '项目',
  'pages': '页面',
  'questions': '问题',
  'switch': '切换',
  'choose': '选择',
  'toggle': '切换',
  'toggle / choose': '切换 / 确认',
  'toggle branch': '切换分支',
  'run': '执行',
  'edit': '编辑',
  'adjust': '调整',
  'finish': '完成',
  'apply': '应用',
  'submit': '提交',
  'confirm': '确认',
  'close': '关闭',
  'leave': '退出编辑',
  'back': '返回',
  'newline': '换行',
  'to search': '搜索',
  'scroll': '滚动',
  'page': '翻页',
  'feedback': '反馈',
  'reject': '拒绝',
  'save': '保存',
  'change': '修改',
  'delete': '删除',
  'navigate': '导航',
  'remove': '移除',
  'install': '安装',
  'Language': '语言',
  'Blue display language; system follows the operating system': 'Blue 界面语言；跟随系统时使用操作系统语言',
  'Follow system': '跟随系统',
  'Update check': '更新检查',
  'boot update check on/off': '启动时是否检查更新',
  'Update channel': '更新通道',
  'dist-tag the boot check follows': '启动更新检查使用的 dist-tag',
  'Theme': '主题',
  'default theme, applied at startup': '启动时应用的默认主题',
  'Collapse thinking': '折叠思考过程',
  'thinking blocks start collapsed': '思考内容默认折叠',
  'Collapse tool calls': '折叠工具调用',
  'tool output starts collapsed (ctrl+o toggles)': '工具输出默认折叠（Ctrl-O 切换）',
  'Transcript window (turns)': '对话窗口（轮次）',
  'completed turns kept mounted': '保留渲染的已完成轮次数',
  'Recent steps kept': '保留最近步骤',
  'steps of a turn keeping their cards': '一轮中保留卡片的步骤数',
  'Ctrl-O range (turns)': 'Ctrl-O 范围（轮次）',
  'turns the expansion toggle reaches back': '展开切换向前覆盖的轮次',
  'User fold lines': '用户消息折叠行数',
  'lines of a user message before it folds': '用户消息超过此行数后折叠',
  'User fold chars': '用户消息折叠字符数',
  'characters of a user message before it folds': '用户消息超过此字符数后折叠',
  'External editor': '外部编辑器',
  'ctrl+g editor command; empty follows $VISUAL/$EDITOR': 'Ctrl-G 使用的编辑器命令；留空跟随 $VISUAL/$EDITOR',
  'Paste backend': '粘贴后端',
  'linux clipboard backend for image paste': 'Linux 图片粘贴使用的剪贴板后端',
  'Shell timeout (ms)': 'Shell 超时（毫秒）',
  'default bash command timeout': 'bash 命令默认超时',
  'Shell max timeout (ms)': 'Shell 最大超时（毫秒）',
  'longest bash timeout a call may request': '单次 bash 调用可请求的最长超时',
  'Shell max output (bytes)': 'Shell 最大输出（字节）',
  'captured bash output budget': 'bash 输出捕获上限',
  'Shell spill budget (bytes)': 'Shell 落盘上限（字节）',
  'on-disk spill cap for oversized output': '超大输出的落盘容量上限',
  'Shell grace (ms)': 'Shell 终止宽限（毫秒）',
  'termination grace before SIGKILL': '发送 SIGKILL 前的终止宽限时间',
  'Max parallel tool calls': '最大并行工具调用数',
  'concurrent tool call cap': '并发工具调用上限',
  'Default reasoning effort': '默认推理强度',
  'default = omit effort': '默认表示不指定推理强度',
  'DeepSeek thinking': 'DeepSeek 思考模式',
  'adapter thinking switch; default = adapter choice': '适配器思考开关；默认由适配器决定',
  'Web search max uses': '网页搜索最大次数',
  'search invocations per request': '每次请求允许的搜索调用次数',
  'Web search max tokens': '网页搜索最大 token 数',
  'search answer token budget': '搜索答案 token 上限',
  'Default permission preset': '默认权限预设',
  'fallback tool policy, per-call editable': '工具权限回退策略；可按调用调整',
  'Default agent preset': '默认 Agent 预设',
  'applies to new sessions; none = composition default': '应用于新会话；无表示使用组合默认值',
  'Blue UI preferences': 'Blue 界面偏好',
  'bash tool limits': 'bash 工具限制',
  'agent loop parallelism': 'Agent 循环并行度',
  'model request defaults': '模型请求默认值',
  'DeepSeek adapter options': 'DeepSeek 适配器选项',
  'web search limits': '网页搜索限制',
  'tool policy presets': '工具权限预设',
  'composition preset default': '组合预设默认值',
  '{count} settings': '{count} 项设置',
  '{description} · {count} settings': '{description} · {count} 项设置',
  'Open settings.yaml in $EDITOR': '在 $EDITOR 中打开 settings.yaml',
  'edit the raw document; changes hot-reload': '直接编辑原始配置；修改会热加载',
  'settings': '设置',
  'settings › {namespace}': '设置 › {namespace}',
  '· esc close · ↵ open': '· Esc 关闭 · ↵ 打开',
  '↑↓ select': '↑↓ 选择',
  '↵ change': '↵ 修改',
  'esc back': 'Esc 返回',
  'restart to apply': '重启后生效',
  'settings service unavailable on this host': '当前 host 没有 settings 服务',
  'settings panel is unavailable: the Blue screen is not mounted': '设置面板不可用：Blue 屏幕尚未挂载',
  'could not update {label}: {message}': '无法更新{label}：{message}',
  '{label} set to {value}': '{label}已设为 {value}',
  'settings file unavailable': '设置文件不可用',
  'no editor configured ($VISUAL/$EDITOR)': '未配置编辑器（$VISUAL/$EDITOR）',
  'could not read settings file: {message}': '无法读取设置文件：{message}',
  'could not write settings file: {message}': '无法写入设置文件：{message}',
  'Edit user settings by namespace (update, theme, folding, transcript, shell, agent, search, permission)': '按命名空间编辑用户设置（更新、主题、折叠、对话、shell、agent、搜索、权限）',
  'Exit Blue': '退出 Blue',
  'Start a new session': '开始新会话',
  'Fork the current session into a new one': '将当前会话派生为新会话',
  'Create a branch from an earlier user turn': '从较早的用户轮次创建分支',
  'List persisted sessions and switch to one (an id resumes directly)': '列出持久化会话并切换（提供 ID 可直接恢复）',
  'Show available commands and key bindings': '显示可用命令和按键绑定',
  'Switch the session model (no argument opens the picker)': '切换会话模型（无参数时打开选择器）',
  'Switch the thinking effort of the current model': '切换当前模型的推理强度',
  'List providers, switch the route, or add one': '列出 provider、切换路由或添加 provider',
  'Toggle auto-approval of tool calls (questions still pop)': '切换工具调用自动批准（问题仍会弹出）',
  'Show the session header, model, and context status': '显示会话头、模型和上下文状态',
  'Show token usage and the context window': '显示 token 用量和上下文窗口',
  'Show the Blue and harness versions and the live model': '显示 Blue、Harness 版本和当前模型',
  'Export the current session as a Markdown file': '将当前会话导出为 Markdown 文件',
  'Copy the last assistant message to the clipboard': '复制最后一条助手消息到剪贴板',
  'List the tools visible to the current session': '列出当前会话可见的工具',
  'List agent presets or switch (blank sessions only)': '列出或切换 Agent 预设（仅空会话）',
  'List available skills (the # prompt invokes one)': '列出可用 skill（在提示中用 # 调用）',
  'List the MCP servers the host connects to': '列出 host 连接的 MCP server',
  'Browse and copy the current session execution trace': '浏览并复制当前会话执行轨迹',
  'Safely update Blue (preflight, snapshot, smoke, auto-rollback)': '安全更新 Blue（预检、快照、smoke、自动回滚）',
  'Browse, install, upgrade, and remove Blue plugins': '浏览、安装、升级和移除 Blue 插件',
  'Analyze the codebase and write AGENTS.md': '分析代码库并编写 AGENTS.md',
  'Commands': '命令',
  'Keys': '按键',
  'help': '帮助',
  'showing {start}-{end} of {total} · ': '显示第 {start}-{end} 项，共 {total} 项 · ',
  'Select': '选择',
  'type to search': '输入以搜索',
  'no matches': '没有匹配项',
  'Allow once': '仅允许一次',
  'Allow {tool} for this session': '本会话允许 {tool}',
  'Reject': '拒绝',
  'Reject with feedback': '拒绝并反馈',
  'Reason': '原因',
  'Plugins': '插件',
  'Installed': '已安装',
  'Catalog': '插件目录',
  'Compatible': '兼容',
  'Needs migration': '需要迁移',
  'Migration required': '需要迁移',
  'Incompatible': '不兼容',
  'Invalid': '无效',
  'Verify': '验证',
  'Remove': '移除',
  'Details': '详情',
  'Install': '安装',
  '{installed} installed · {indexed} indexed · {status}': '已安装 {installed} · 已索引 {indexed} · {status}',
  'vetted snapshot · refreshing GitHub': '已审核快照 · 正在刷新 GitHub',
  'catalog refreshed from GitHub': '已从 GitHub 刷新目录',
  'vetted catalog snapshot': '已审核目录快照',
  'offline · using vetted snapshot': '离线 · 使用已审核快照',
  'No Blue plugins installed': '尚未安装 Blue 插件',
  'Open Catalog to inspect indexed plugins.': '打开插件目录查看已索引插件。',
  'No plugins indexed': '暂无已索引插件',
  'The vetted catalog snapshot is empty.': '已审核目录快照为空。',
  'Version': '版本',
  'Status': '状态',
  'Repository': '仓库',
  'Commit': '提交',
  'Capabilities': '能力',
  'Already installed in this profile': '已安装在当前 profile',
  'none declared': '未声明',
  'Verifying {plugin}...': '正在验证 {plugin}...',
  'Uninstalling {plugin}...': '正在移除 {plugin}...',
  'Installing {plugin}...': '正在安装 {plugin}...',
  'plugin operation failed: {message}': '插件操作失败：{message}',
  'uninstalled; restart Blue to apply': '已移除；重启 Blue 后生效',
  'installed; restart Blue to apply, then run /plugin verify {plugin}': '已安装；重启 Blue 后生效，再运行 /plugin verify {plugin}',
  'catalog refresh failed: {message}': '插件目录刷新失败：{message}',
  'Approve {tool}?': '是否批准 {tool}？',
  'Question {current} of {total}': '问题 {current}/{total}',
  'Other': '其他',
  'Other: {value}': '其他：{value}',
  'Answer': '回答',
  '{label} cannot be empty': '{label}不能为空',
  'cancel': '取消',
  '(no output)': '（无输出）',
  '… output truncated': '… 输出已截断',
  'exit code {code}': '退出码 {code}',
  'no matching files under the session cwd': '会话工作目录下没有匹配文件',
  'Subagents': '子代理',
  'no subagents in this session': '本会话没有子代理',
  'Enter attach · Space expand · Esc close': '回车 attach · 空格展开 · Esc 关闭',
  'the attach view is unavailable: the blue-attach-view plugin is not mounted': 'attach 视图不可用：blue-attach-view 插件未挂载',
  'Subagent': '子代理',
  'running': '运行中',
  'idle': '空闲',
  'Say to this subagent…': '对这个子代理说…',
  'one-shot subagent — read-only': '一次性子代理 — 只读',
  'Enter follow up · Ctrl+C interrupt · q back': '回车追问 · Ctrl+C 中断 · q 返回',
  'q back': 'q 返回',
  'attach view is unavailable: the Blue screen is not mounted': 'attach 视图不可用：Blue 屏幕尚未挂载',
}

const en = Object.freeze(Object.fromEntries(Object.keys(zh).map(key => [key, key])))

/** Interaction package locale catalog. */
export const INTERACTION_LOCALE: BlueLocaleCatalog = Object.freeze({ en, zh: Object.freeze(zh) })

/**
 * Register the package catalog whenever a locale provider is active.
 * @param ctx - interaction root context.
 */
export function mountInteractionLocale(ctx: Context): void {
  ctx.inject(['blueLocale'], (localeCtx) => {
    localeCtx.effect(() => localeCtx.blueLocale.register('interaction', INTERACTION_LOCALE))
  })
}

/**
 * Return a translator that resolves the current service for every call.
 * @param ctx - frontend-tree context.
 * @returns dynamic interaction translator.
 */
export function interactionTranslator(ctx: Context): BlueTranslate {
  return (key, values) => ctx.get('blueLocale')?.translate('interaction', key, values)
    ?? interpolateLocaleMessage(key, values)
}

/**
 * Observe locale/catalog revisions across provider unload and reload.
 * @param ctx - owner context.
 * @param listener - callback receiving each active provider snapshot.
 * @returns disposer for the injected observer Fiber.
 */
export function observeInteractionLocale(
  ctx: Context,
  listener: (snapshot: BlueLocaleSnapshot | undefined) => void,
): () => void {
  let disposed = false
  let offCurrent: () => void = () => {}
  const current = ctx.get('blueLocale')
  if (current !== undefined) offCurrent = current.subscribe(listener)
  const fiber = ctx.inject(['blueLocale'], (localeCtx) => {
    /* v8 ignore next -- disposing the injected Fiber prevents late activation; this is a defensive fence. */
    if (disposed) return
    offCurrent()
    const off = localeCtx.blueLocale.subscribe(listener)
    offCurrent = off
    localeCtx.effect(() => () => {
      off()
      /* v8 ignore next -- Cordis forbids overlapping providers and serializes unload before replacement activation. */
      if (offCurrent !== off) return
      offCurrent = () => {}
      if (!disposed) listener(undefined)
    })
  })
  return () => {
    if (disposed) return
    disposed = true
    offCurrent()
    void fiber.dispose()
  }
}
