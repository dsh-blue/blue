# 对接 Blue：下游插件开发指南

Blue 的扩展表面由 Cordis plugin host 管理：你的插件声明 capability，贡献 renderer-neutral 的 view/action，卸载时自动回滚。本篇从零走通一个下游插件的完整对接流程；完整的接合面清单见 [Seam 参考](/plugins/seams)，bundle 内部组成见[内置插件](/plugins/builtins)。

::: warning 预览阶段提醒
缝的签名计划在 Phase 3 冻结；当前接入的插件随版本升级可能需要适配。本站会随每次发布同步更新。
:::

## 对接模型：你的插件挂在同一棵 Cordis 树上

Blue 不是一个独立应用，而是 dsh 进程里一棵 Cordis 插件树上的一组插件行。下游插件不需要 SDK 进程、IPC 或配置文件——它就是一个普通 Cordis 插件，与 Blue 的 28 行运行在同一棵树里：

```text
dsh 进程（Cordis 树）
├── dsh-base 行        — Harness domain：agents · sessions · tools · approval
├── Blue 行            — TUI：bluePluginHost 在这里提供服务
└── 你的插件行          — 通过 cordis.patch.yml 插入，inject bluePluginHost
```

对接动作只有一个：**向 `bluePluginHost` 声明 manifest、拿到按能力裁剪的 API、注册贡献**。贡献是数据（`BlueView`）和结构化 action，不是 UI 组件——渲染统一由 Blue 的 TUI kernel 完成，你的代码永远不接触 pi-tui、ANSI 或终端宽度。

当前阶段 `open()` 只开放四个 capability：`commands`、`status`、`dock`、`notifications`。manifest schema 还声明了 `tools`、`editor`、`panels`、`session.read`、`session.act` 五个能力，申请其中任何一个都会被拒绝并返回 `BLUE_CAPABILITY_DENIED`——它们预留给后续阶段，签名未定。

## 第一步：包骨架

一个最小插件包的形态：

```text
my-plugin/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts        # 插件入口
```

`package.json` 的关键字段：

```json
{
  "name": "my-scope/my-plugin",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "dependencies": { "@dsh-blue/blue-api": "^0.1.0-rc.8" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

- `@dsh-blue/blue-api` 是唯一需要依赖的 Blue 包——它是纯契约（manifest 校验 + 类型），不含渲染器或终端代码。
- Cordis 由宿主 dsh 安装提供，声明为 peer；**不要**把 dsh/cordis 打进自己的 dependencies，否则会出现第二份服务实例。
- 插件入口与普通 Cordis 插件完全一致：导出 `name`（稳定字符串）、可选 `inject`（声明的服务就位后才激活）、`apply(ctx)`。

## 第二步：manifest 与 open()

```ts
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入：拉入 Context.bluePluginHost 的声明合并
import type {} from '@dsh-blue/blue-api'

export const name = 'my-plugin.clock'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'my-plugin.clock',        // 小写命名空间 id，可带 @scope/ 前缀
    api: '^1.0.0',                // 对宿主 BLUE_API_VERSION（1.x 线）的 semver 范围
    capabilities: ['status', 'commands'],
  })
  if (!opened.ok) {
    // 结构性失败（版本不兼容 / 能力未开放）：放弃挂载，不要把异常抛进宿主
    return
  }
  const api = opened.value // BluePluginApi：只暴露声明过的 capability
}
```

要点：

- `open(ctx, manifest)` 先用 `validateBlueManifest` 静态校验（不执行插件代码），再返回**按能力裁剪**的 `BluePluginApi`——没声明的 capability 在返回对象上是 `undefined`。
- 所有失败都是结构化 `BlueResult`（`{ ok: false, code, message }`），插件错误不以异常形式穿越公共边界——你的代码也不应向上抛。
- 返回的每个注册都绑定调用方 Fiber：**插件卸载时贡献自动回滚**，不需要自己写清理逻辑。

## 第三步：注册贡献（四个能力）

### `commands` — slash 命令

```ts
api.commands?.register({
  id: 'now',                    // 即 /now；重复 id 会被拒绝（BLUE_DUPLICATE_ID）
  label: 'Print the current time',
  execute: async (args, { signal, rawInput } = {}) => {
    // args：按空白切分的参数；signal：中止信号；rawInput：原始输入行
    return { ok: true, value: undefined }
  },
})
```

注册后 `/now` 自动出现在编辑器的斜杠补全和 `/help` 里，不需要额外注册 UI。id 必须匹配小写命名空间格式（`my-plugin.now` 这样的带点 id 也可以）；`blue.`、`blue:`、`blue-`、`@dsh-blue/` 前缀是 Blue 保留的 owner 命名空间。

### `status` — 状态栏条目

```ts
api.status?.register({
  id: 'clock.status',
  priority: 25,                 // 可选元数据；当前状态栏按注册顺序排布，priority 只对 dock 面板生效
  render: () => ({ kind: 'text', content: new Date().toLocaleTimeString(), tone: 'muted' }),
})
```

`render()` 返回 `BlueView | null`（null 即本帧不显示）。状态栏条目渲染在底部 footer；超宽的条目会被截断或隐藏，所以内容保持短小。

### `dock` — 底部 dock 面板

```ts
api.dock?.register({
  id: 'clock.pane',
  view: () => ({ kind: 'fields', rows: [{ label: 'time', value: [{ text: new Date().toLocaleTimeString() }] }] }),
  priority: 40,                 // dock 面板按 priority 排序
  preferredRows: 3,             // 期望行数
  minRows: 1,                   // 最小行数
  collapsible: true,            // 可被折叠
})
```

`view` 可以是静态 `BlueView` 或返回 `BlueView | null` 的函数。dock 面板排在编辑器上方的底部区域（activity/queue/todo/btw/agents 是内置面板）。

### `notifications` — 通知

```ts
api.notifications?.publish({
  id: 'clock.tick',             // 同 id 去重
  view: { kind: 'text', content: 'tick', tone: 'accent' },
})
const sub = api.notifications?.subscribe(notification => { /* ... */ })
```

发布与订阅都是 renderer-neutral 的；以 toast、状态还是日志呈现由渲染器决定。

## BlueView 词汇表

所有 view 类贡献共用这一套 renderer-neutral 词汇（`@dsh-blue/blue-api` 的 `BlueView`）：

| kind | 形态 | 字段 |
| --- | --- | --- |
| `text` | 一段文本 | `content`，可选 `tone` |
| `fields` | 标签-值对列表 | `rows: BlueField[]`（`label` + `BlueInlineSpan[]`） |
| `code` | 代码块 | `code`，可选 `language` |
| `diff` | 前后对比 | `before` / `after` |
| `sections` | 分节组合 | `sections: BlueSection[]`（可选 `title`、`collapsed`，`body` 递归为 BlueView） |

颜色只有语义色调 `BlueTone`：`default | muted | accent | success | warning | danger`；行内片段（`BlueInlineSpan`）可带 `emphasis: 'strong'`。**不要**在文本里嵌 ANSI 转义或按终端宽度手工排版——宽度预算是渲染器的事，超宽内容会被统一截断。

## BlueResult 错误码

公共边界上的所有失败都用同一套错误码（`BlueErrorCode`）：

| code | 含义 |
| --- | --- |
| `BLUE_API_INCOMPATIBLE` | manifest 的 `api` 范围与宿主版本不兼容 |
| `BLUE_CAPABILITY_DENIED` | 申请了未开放的能力（现阶段即四个之外的全部） |
| `BLUE_CAPABILITY_ABSENT` | 探测的可选 Harness 能力不存在——按降级处理，不是插件失败 |
| `BLUE_DUPLICATE_ID` | 贡献 id 已被注册（跨所有消费者判定） |
| `BLUE_INVALID_CONTRIBUTION` | 贡献格式不合法（id 字符、priority 非整数等） |
| `BLUE_ACTION_REJECTED` | 动作被宿主拒绝（如占用 Blue 保留命名空间） |
| `BLUE_LIMIT_EXCEEDED` / `BLUE_ABORTED` / `BLUE_SESSION_UNAVAILABLE` | 超限 / 被中止 / 会话不可用 |

## 数据从哪来：Domain 与 adapter 的分工

`session.read` 尚未开放，所以插件目前**不能**通过 Blue 读会话内容。需要 Harness 侧数据时，走 Cordis 服务注入——你的插件与 Harness domain 插件同处一棵树，可以 `inject` Harness 的官方服务（`ctx.sessions`、`ctx.commands` 等）。推荐按 renderer 拆分：

```text
@scope/feature        Domain 包：headless/Web/TUI 共用，不 inject 任何 Blue 服务
@scope/feature-blue   Blue adapter 包：inject bluePluginHost，只做 UI 贡献
```

这样 headless profile（没有 Blue 的树）加载 domain 包也不会 pending。adapter 里探测到的可选能力缺失时按降级处理：不注册对应贡献，而不是让整棵树挂起。

纪律底线：不 import Blue 包的内部文件（只用 `@dsh-blue/blue-api` 的公开契约）；不持有 Agent、Session、renderer 对象；产品级可变状态不放模块级 singleton（多棵 frontend tree 会共享它）。

## 第四步：装进 profile 本地调试

1. 在 profile 的 `cordis.patch.yml` 插入一行（行可增删重排，零代码定制）：

```yaml
- id: my-plugin-clock
  name: 'my-scope/my-plugin'
```

2. 开发期用 link 装入：

```sh
dsh plugin --profile blue-dev add link:/path/to/my-plugin
dsh --profile blue-dev
```

3. 迭代环：改代码 → 重新构建你的包 → 重启 profile（或用 dsh 的 HMR，视你的包形态而定）。验证卸载语义：从 patch 里删掉你的行，贡献应全部消失、不留残骸。

## 第五步：验证

Blue 仓库提供两个脚本（克隆 Blue 仓库后运行）：

```sh
node script/blue-plugin-validate.mjs /path/to/my-plugin          # 结构与边界静态检查
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install # 打包安装契约 fixture
```

- `validate` 输出 JSON 报告，分 package（manifest、exports、files）、architecture（依赖方向、违禁 import）、lifecycle（Fiber 绑定）三组检查。
- `fixture` 在一次性 npm 项目里打包装载你的插件，验证独立安装场景下的真实行为。

## 发布

普通 npm 包即可：`npm publish`（预览期建议 `@rc` 之类的 dist-tag 与 Blue 线对齐）。用户安装路径是 `dsh plugin --profile blue add my-scope/my-plugin`——没有 `dsh.bundle` 声明的包只会作为普通依赖安装，记得指导用户在 profile 的 `cordis.patch.yml` 加上你的插件行。插件市场（一键安装、发现）在路线图上，见[插件市场](/marketplace/)。

## 下一步

- [Seam 参考](/plugins/seams) —— stable plugin host 与 Blue 内部 projection/action/model 边界的完整清单；
- [内置插件](/plugins/builtins) —— bundle 的 28 条 Blue 自有行，是最完整的插件范例集；
- [贡献本仓库](/plugins/contributing) —— 给 Blue 本身贡献代码的本地开发流程。
