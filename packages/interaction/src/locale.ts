/**
 * Interaction-owned locale catalog and registration helper. English source
 * strings double as stable keys, keeping command/domain identifiers out of
 * the translation boundary.
 *
 * @module @dsh-blue/blue-interaction/locale
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueLocaleCatalog, BlueTranslate } from '@dsh-blue/blue-frontend'

const zh: Readonly<Record<string, string>> = {
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
  'No settings available': '没有可用设置',
  'No matching settings': '没有匹配的设置',
  'Type to search · Enter/Space to change · Esc to cancel': '输入以搜索 · Enter/空格修改 · Esc 取消',
  'Enter/Space to change · Esc to cancel': 'Enter/空格修改 · Esc 取消',
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
  '· Esc / Enter / q to cancel · ↑↓ scroll': '· Esc / Enter / q 关闭 · ↑↓ 滚动',
  'showing {start}-{end} of {total}': '显示第 {start}-{end} 项，共 {total} 项',
  'Allow once': '仅允许一次',
  'Allow {tool} for this session': '本会话允许 {tool}',
  'Reject': '拒绝',
  'Reject with feedback': '拒绝并反馈',
  'reason:': '原因：',
  '▶ Approve {tool}?': '▶ 是否批准 {tool}？',
  'type feedback': '输入反馈',
  '↵ submit': '↵ 提交',
  'esc cancel': 'Esc 取消',
  '↑/↓ select': '↑/↓ 选择',
  '1-4 choose': '1-4 选择',
  '↵ confirm': '↵ 确认',
  'Question {current} of {total}': '问题 {current}/{total}',
  'Other': '其他',
  'Other: {value}': '其他：{value}',
  '↵ save': '↵ 保存',
  'tab next': 'Tab 下一个',
  'space toggle': '空格切换',
  '↵ choose': '↵ 选择',
  'Answer': '回答',
  '(no output)': '（无输出）',
  '… output truncated': '… 输出已截断',
  'exit code {code}': '退出码 {code}',
  'no matching files under the session cwd': '会话工作目录下没有匹配文件',
}

const en = Object.freeze(Object.fromEntries(Object.keys(zh).map(key => [key, key])))

/** Interaction package locale catalog. */
export const INTERACTION_LOCALE: BlueLocaleCatalog = Object.freeze({ en, zh: Object.freeze(zh) })

/**
 * Register the interaction catalog when the locale runtime is present.
 * @param ctx - frontend-tree context.
 * @returns registration disposer.
 */
export function registerInteractionLocale(ctx: Context): () => void {
  return ctx.get('blueLocale')?.register('interaction', INTERACTION_LOCALE) ?? (() => {})
}

/**
 * Return a dynamic interaction translator with an English host fallback.
 * @param ctx - frontend-tree context.
 * @returns namespace-bound translator.
 */
export function interactionTranslator(ctx: Context): BlueTranslate {
  return ctx.get('blueLocale')?.bind('interaction') ?? ((key, values) => {
    if (values === undefined) return key
    return key.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (placeholder, name: string) => {
      const value = values[name]
      /* v8 ignore next -- callers supply values for their literal catalog placeholders */
      return value === undefined ? placeholder : String(value)
    })
  })
}
