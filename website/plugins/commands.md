# 命令

`commands` 能力把 slash 命令注册进 Harness 命令注册表：自动出现在编辑器的斜杠补全和 `/help` 里，不需要额外注册 UI。

## 契约

```ts
api.commands?.register(contribution: BlueCommandContribution): BlueResult<BlueRegistration>
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 命令名（用户输入 `/id`）。必须匹配 `^[a-z][a-z0-9_-]*$`——注意比一般贡献 id 严格，**不允许点号** |
| `label` | `string` | 非空描述，显示在补全与 `/help` |
| `execute` | `(args, options?) => Promise<BlueResult>` | 处理器，见下 |
| `priority` | `number?` | 可选整数元数据 |

`execute(args, options)` 的参数：

| 参数 | 说明 |
| --- | --- |
| `args` | `rawInput` 去除首尾空白后按空白切分的数组；无参数时是 `[]` |
| `options.signal` | `AbortSignal`，会话中止时触发——长任务必须响应它 |
| `options.rawInput` | 原始输入行（未切分），需要自己解析引号时用 |

## 完整示例

一个把文本追加到文件、可中止的命令。下面的 `manifest` 是已经通过
`validateBluePluginManifestV1()` 的 canonical `blue.plugin.json`；它的 capability
请求至少包含：

```json
{
  "capabilities": {
    "required": [
      { "name": "commands", "version": "^1.0.0", "resources": { "names": ["clip"] } }
    ],
    "optional": [
      { "name": "notifications.publish", "version": "^1.0.0" }
    ]
  }
}
```

```ts
const opened = ctx.bluePluginHost.open(ctx, manifest)
if (!opened.ok) return
const api = opened.value.api

const registered = api.commands?.register({
  id: 'clip',
  label: 'Append text to ~/clip.log',
  execute: async (args, { signal } = {}) => {
    if (args.length === 0) {
      return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'usage: /clip <text>' }
    }
    if (signal?.aborted) {
      return { ok: false, code: 'BLUE_ABORTED', message: 'aborted' }
    }
    await appendFile(`${homedir()}/clip.log`, `${args.join(' ')}\n`)
    const published = api.notifications?.publish({
      id: 'clip.saved',
      view: { kind: 'text', content: `saved ${args.length} word(s)` },
      tone: 'success',
    })
    if (published !== undefined && !published.ok) return published
    return { ok: true, value: undefined }
  },
})
if (registered !== undefined && !registered.ok) ctx.logger.warn(registered.message)
```

## 行为细节

- **名字是 exact resource**：canonical manifest 必须声明 1–64 个 command name；注册未获准 name 返回 `BLUE_RESOURCE_DENIED`，同一 consumer 最多保留 64 个 command contribution；
- **重复 id 被拒**：`register()` 返回 `BLUE_DUPLICATE_ID`。与内置命令或其他插件的命令撞名同样在注册时失败——`register` 的返回值要检查，失败时按降级处理；
- **返回值即用户反馈**：`{ ok: false, code, message }` 的 `message` 会作为错误文本显示在编辑器通知条；`execute` 抛出的异常会被桥接层兜底为 `plugin command failed: ...` 显示——兜底不是契约，主动返回结构化错误；
- **成功是静默的**：`{ ok: true }` 不产生任何输出。要给用户反馈就申请 [`notifications.publish`](/plugins/notifications) 发一条；
- **卸载即消失**：注册绑定调用方 Fiber，插件卸载后命令从注册表移除，补全和 `/help` 同步消失。
- **旧回调不能提交**：owner replacement、consumer unload 或 signal abort 会拒绝旧 command generation 的迟到结果；Host 不在 owner gap 中重放 command action。

## 常见错误

| 现象 | 原因 |
| --- | --- |
| `BLUE_INVALID_CONTRIBUTION` | id 含大写、点号或前导数字；`label` 为空；`execute` 不是函数 |
| `BLUE_ACTION_REJECTED` | id 以 `blue.` / `blue:` / `blue-` / `@dsh-blue/` 开头——这是 Blue 的保留命名空间 |
| `BLUE_DUPLICATE_ID` | 与已注册命令撞名（含内置命令） |
| 补全里没有我的命令 | `register()` 失败了而你没看返回值；或插件行没进 patch |

## 参考

- 参数与中止语义的设计动机见[核心概念](/plugins/concepts)；
- 内置命令的注册方式见 `blue-interaction`（[内置插件](/plugins/builtins)）。
