# 快速开始

本篇从零跑通一个下游插件：十分钟内你会得到一个挂在 Blue 状态栏上的时钟插件，并验证它的卸载语义。概念解释从简——设计动机与完整契约见[核心概念](/plugins/concepts)。

## 前置条件

| 依赖 | 版本 |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| dsh CLI | `npm i -g @deepseek-ai/dsh` |
| 一个装好 Blue 的 profile | `dsh plugin --profile blue-dev add @dsh-blue/blue@rc`（见[快速上手](/guide/)） |

开发自己的插件建议用一个独立 profile（如 `blue-dev`），不要动日常使用的 `blue` profile。

## 1. 包骨架

```text
blue-clock/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts        # 插件入口
```

`package.json` 的关键字段：

```json
{
  "name": "my-scope/blue-clock",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "dependencies": { "@dsh-blue/blue-api": "^0.1.0-rc.9-test.6" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

- 包名里含 `blue` / `frontend` / `adapter` 之一，Blue 的 validate 脚本才能识别它为 Blue 前端包（见[调试与验证](/plugins/testing)）；
- `@dsh-blue/blue-api` 是唯一需要依赖的 Blue 包——它是纯契约（manifest 校验 + 类型），不含渲染器或终端代码；
- Cordis 由宿主 dsh 安装提供，声明为 peer。**不要**把 dsh/cordis 打进自己的 `dependencies`，否则树里会出现第二份服务实例；
- 入口与普通 Cordis 插件完全一致：导出 `name`（稳定字符串）、可选 `inject`（声明的服务就位后才激活）、`apply(ctx)`。npm 包名与 Cordis 插件名是两个独立命名空间，不必相同。

构建用任意 TS 工具链均可（tsc、tsdown、tsup……），只要 `exports` 指向产物。插件是 ESM-only。

## 2. 插件入口

`src/index.ts`：

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

  api.status?.register({
    id: 'clock.status',
    render: () => ({ kind: 'text', content: new Date().toLocaleTimeString(), tone: 'muted' }),
  })

  api.commands?.register({
    id: 'now',                    // 即 /now
    label: 'Print the current time',
    execute: async () => {
      console.log(new Date().toISOString())
      return { ok: true, value: undefined }
    },
  })
}
```

三个要点：

- `open(ctx, manifest)` 先静态校验 manifest（不执行插件代码），再返回**按能力裁剪**的 `BluePluginApi`——没声明的 capability 在返回对象上是 `undefined`；
- 所有失败都是结构化 `BlueResult`（`{ ok: false, code, message }`），插件错误不以异常形式穿越公共边界——你的代码也不应向上抛；
- 每个注册返回 `BlueRegistration` 并绑定调用方 Fiber：**插件卸载时贡献自动回滚**，不需要自己写清理逻辑。

## 3. 装进 profile

在 profile 的 `cordis.patch.yml` 插入一行（行可增删重排，零代码定制）：

```yaml
- id: my-plugin-clock
  name: 'my-scope/blue-clock'
```

开发期用 link 装入：

```sh
dsh plugin --profile blue-dev add link:/path/to/blue-clock
dsh --profile blue-dev
```

启动后你应该看到：底部 footer 多出一个时钟条目；输入 `/now` 有斜杠补全，回车后时间打印到终端。

## 4. 验证卸载语义

从 patch 里删掉你的插件行（或 `dsh plugin --profile blue-dev remove my-scope/blue-clock`），重启 profile：时钟条目和 `/now` 应当全部消失、不留残骸。这是 Fiber 绑定注册的应有行为——如果留下了残骸，说明你的插件在 `open()` 之外绕路注册了东西，参考[核心概念](/plugins/concepts#设计纪律)排查。

## 5. 迭代回路

改代码 → 重新构建你的包 → 重启 profile。链接指向包目录，重建产物直接生效，无需重装；只有依赖图变化（新增依赖）才需要重新 `add`。

验证就绪后，用 Blue 仓库的静态检查和打包 fixture 做发布前验证，然后就可以[发布](/plugins/publishing)了——详见[调试与验证](/plugins/testing)。

## 下一步

- [核心概念](/plugins/concepts) —— 理解 capability 裁剪、`BlueView` 词汇表和 domain/adapter 拆分；
- [命令](/plugins/commands)、[状态栏](/plugins/status)、[Dock 面板](/plugins/dock)、[通知](/plugins/notifications) —— 四个能力的完整契约；
- [内置插件](/plugins/builtins) —— Blue 自己的 28 行就是最完整的范例集。
