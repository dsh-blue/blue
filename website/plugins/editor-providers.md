# 编辑器 Provider

> 状态：**Experimental / reference**。`editor.provider` 不属于 Stable v1 root；当前实现保留 provider swap、fallback 与 lifecycle 证据，但在真实外部消费者共创前不作稳定兼容承诺。

`editor.provider` 注册一个可替换整个 editor shell 的候选。Provider 可以重排模式信息、辅助内容和结构化 action，但编辑引擎仍由 Blue 所有：draft、cursor、history、undo、IME、paste、attachment 与 submit 路径不会交给插件。

## 快速开始

下面的插件只使用公开 `@dsh-blue/blue-api` 契约。它手写 renderer-neutral node，不导入 core、pi-tui 或仓库内部模块：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { BlueEditorProvider } from '@dsh-blue/blue-api'
import type {} from '@dsh-blue/blue-api'

export const name = 'acme.focused-editor'
export const inject = ['bluePluginHost']

const provider: BlueEditorProvider = {
  id: 'acme.focused-editor.shell',
  render: snapshot => ({
    kind: 'stack',
    direction: 'column',
    gap: 1,
    children: [
      {
        node: {
          kind: 'rich-text',
          spans: [
            { text: snapshot.mode, tone: 'accent', emphasis: 'strong' },
            { text: snapshot.busy ? ' · working' : ' · ready', tone: 'muted' },
          ],
        },
      },
      { node: { kind: 'editor-control' } },
      {
        node: {
          kind: 'text',
          content: `${snapshot.attachments.length} attachments · ${snapshot.extensions.length} extensions`,
          tone: 'muted',
        },
      },
    ],
  }),
}

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'acme.focused-editor',
    api: '^1.0.0-beta.1',
    capabilities: ['editor.provider'],
  })
  if (!opened.ok || opened.value.editorProviders === undefined) return

  const registered = opened.value.editorProviders.register(provider)
  if (!registered.ok) ctx.logger.warn(registered.message)
}
```

注册只是增加候选，不会接管当前编辑器。用户必须在 `settings.yaml` 中明确选择它：

```yaml
blue:
  editorProvider: acme.focused-editor.shell
```

改回 `blue.default` 即恢复内置 shell。安装新 provider、同 id 重载或注册 refresh 都不会改写用户设置，也不会自动切换选择。

## 契约

```ts
api.editorProviders?.register(provider: BlueEditorProvider): BlueResult<BlueRefreshRegistration>
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 全局唯一、非 Blue 保留命名空间的候选 id |
| `render` | `(snapshot: BlueEditorSnapshot) => BlueEditorShellNode` | 同步返回完整 shell；应保持纯净、廉价，不做 I/O |
| `onEvent` | `BlueUiEventHandler?` | 可选结构化事件 handler；不接收 raw key 或 renderer object |

`BlueEditorSnapshot` 是冻结的 readonly 值，只含：

- `mode`: `normal | plan | yolo`；
- `busy`: 当前主会话是否运行；
- `attachments`: 当前 draft 中已接纳 attachment 的只读 metadata；
- `extensions`: 已接纳 `editor.extensions` 的被动快照。

Snapshot 不含 draft 文本、cursor、history、undo stack 或 IME 状态。Provider 不能从公共 API 读取这些值。

## `editor-control` 不变量

每个 shell 必须恰好包含一个可见 `{ kind: 'editor-control' }`。它是 Blue 自有编辑引擎的唯一挂载槽，不属于普通 `BlueUiNode`，也不能出现在 pane 或 overlay 中。

下列候选都会在激活前被拒绝：

- 没有 `editor-control`；
- 包含两个或更多 `editor-control`；
- 用 `when` 条件隐藏 control；
- 用零尺寸 child 约束隐藏 control；
- 返回非法 node、抛异常，或 dry-render 产生 runtime failure。

Blue 在实际 editor 宽度下先编译并 dry-render，再暂停输入分发、原子替换 shell、恢复同一个 editor 对象及焦点并强制重绘。Provider 替换的是外壳，不是编辑引擎。

## 事件与生命周期

Provider 可以在 shell 中放置 canonical action、list、tabs 或 form control，并通过 `onEvent` 接收语义事件。事件 context 含 owner 管理的 `signal`、`revision` 和一次用户操作范围内的 `userGesture`。普通 action 按 provider id 串行；value、selection 与 tab change 使用 latest-wins。回调有 30 秒上限，切换、refresh、unload、abort 和迟到结果都不能再修改当前 shell。

注册与调用分离：注册、host snapshot 与 owner replay 都不会执行 `render` 或 `onEvent`。Provider 的注册绑定调用方 Cordis Fiber；插件卸载会移除候选，但不会删除 `blue.editorProvider` 的期望 id。同 id provider 以后重新出现时，原选择可以再次生效。

## 失败与回退

- 首次激活时 desired id 缺失、非法或失败：继续使用 `blue.default`；
- 从正常 A 切到坏 B：保留 A 作为当前 last-known-good shell；
- 已激活 provider 运行时失败：回滚到切换前 shell；
- 同一 candidate generation 在滚动 60 秒内失败三次：打开无定时器 breaker 并回落 `blue.default`；只有最新 generation 真正提交成功 live frame 后才重置预算，dry-render 成功和旧 LKG frame 都不能清除新 candidate 的失败；切走再选或同 id 新 generation 才重试。

所有情况都保留原 settings 值。Provider 故障不会清空 draft、消费 attachment、破坏 submit barrier，或阻塞 Agent loop。

## 与编辑器扩展的关系

`editor.extensions` 是可叠加增强；`editor.provider` 是用户选择的独占 shell。Blue 会尝试把已接纳扩展组合在 provider shell 周围，并把扩展的被动信息放进 snapshot。Provider 不调用扩展 callback，也不能绕过扩展的 abort、timeout 和 stale fence。只需要 hint、completion、diagnostic、action 或 submit transform 时，优先使用[编辑器扩展](/plugins/editor-extensions)。

## 常见错误

| 现象 | 原因 |
| --- | --- |
| 注册成功但界面没变化 | 候选保持 inert；`blue.editorProvider` 尚未选择它 |
| `open()` 返回 `BLUE_CAPABILITY_ABSENT` | 当前 profile 缺少 durable editor-provider registration 支持；升级/修复 Blue 组合后再试 |
| 选择后回落默认 shell | shell 不满足单一可见 control、编译/dry-render 失败，或 breaker 已打开 |
| 想直接读取或改写 draft | 公共 provider 不拥有 editing engine；把文本处理放到 `editor.extensions` 的 submit transform |
| 试图监听 raw key | 公共边界只交付结构化 `BlueUiEvent`；raw terminal input 只属于 core |

相关配置见[配置指南](/guide/config#blue-blue-自己的设置段)，内部 owner 映射见 [Seam 参考](/plugins/seams)。
