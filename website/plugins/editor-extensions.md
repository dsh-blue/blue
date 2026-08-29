# 编辑器扩展

> 状态：**Experimental / reference**。`editor.extensions` 保留成熟 runtime 和 fixture 供共创验证，但不属于 Stable v1 root；在后续真实消费者证据完成前，名称和 contract 可以变化。

`editor.extensions` 在 Blue 自有编辑引擎周围增加 renderer-neutral 的提示、诊断、补全、action 与提交转换。扩展不能读取 draft、history、cursor 或 IME，也不能替换编辑引擎；需要重排整个 shell 的场景属于独占 `editor.provider`，不在本能力内。

## 注册

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'

export const name = 'acme.editor-helper'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'acme.editor-helper',
    api: '^1.0.0-beta.1',
    capabilities: ['editor.extensions'],
  })
  if (!opened.ok || opened.value.editorExtensions === undefined) return

  opened.value.editorExtensions.register({
    id: 'acme.editor-helper.main',
    priority: 40,
    hint: 'Repository issue keys can be completed with #',
    diagnostics: [{ id: 'privacy', message: 'Review secrets before submitting', tone: 'warning' }],
    actions: [{ id: 'insert-template', label: 'Insert template', intent: 'secondary' }],
    onEvent: async (event) => {
      if (event.kind === 'activate' && event.controlId === 'insert-template') {
        // Dispatch a structured host action here. Raw editor input is unavailable.
      }
      return { ok: true, value: undefined }
    },
    completeV2: async (request) => {
      if (request.trigger !== '#') return { ok: true, value: [] }
      return {
        ok: true,
        value: [{ id: 'issue-72', label: '#72 UI API', insertText: '#72', detail: 'open issue' }],
      }
    },
    transformSubmit: async (request, context) => {
      if (context.signal.aborted) return { ok: false, code: 'BLUE_ABORTED', message: 'submission changed' }
      return { ok: true, value: { text: request.text.replaceAll('WIP', 'work in progress') } }
    },
  })
}
```

注册只保存贡献，不会调用 `complete`、`completeV2`、`transformSubmit` 或 `onEvent`。Blue owner 挂载或重载后会重放仍有效的注册；插件 Fiber 卸载时注册自动撤销。

## Shell 与 action

`before` 和 `after` 接受递归的 `BlueEditorExtensionNode`：text、rich text、fields、code、diff、sections、progress、spacer、divider，以及只包含这些节点的 stack/surface。它们是 passive 内容；交互命令必须放进 `actions`，并由 `onEvent` 接收原始 action id。

Blue 逐贡献校验、复制和冻结这些节点，再围绕同一个自有 editor 编译 shell。坏贡献不会获得 renderer object，也不能隐藏或复制 editor。extension refresh、session/theme 变化和 owner unload 会 abort 未完成的 event、补全与提交工作；迟到结果被丢弃。

`onEvent` 由显式用户动作触发。context 的 `surfaceId` 是 extension contribution id；其中的 `userGesture` 是一次性 proof，可用于同一合法异步调用链内打开 capturing overlay；回调结束或 owner 卸载后 proof 失效。同一扩展的 action 按 FIFO 执行，不同扩展互不阻塞。

## 补全

当前 Beta 的兼容 callback `complete` 只接收 `/`、`@` 和 `manual` trigger。需要同时接收这些 trigger 与 `#` 时显式使用 `completeV2`；两者同时存在时 Blue 只调用 `completeV2`。Blue 会把公共结果与内建 slash/file/skill source 合并，按最新请求接纳，并使用每项自己的 prefix 应用文本。item id 在单次结果内必须唯一；label、insertText、detail 与总 item 数都有上限。无效、超时、aborted 或 stale 结果不会进入下拉框。

## 提交转换与附件

提交转换发生在编辑器清空之前，并按较小 priority 优先串行运行。转换 pending 时 draft、paste table、undo 与 history cursor 保持原状；任一回调拒绝、超时、abort 或返回无效结果都会取消本次提交并保留草稿。只有所有转换成功后 Blue 才提交并清空 editor。

转换只能返回 `{ text }`。`request.attachments` 是同一份冻结的只读 metadata snapshot；已知 `[image #N]` marker 不会出现在传给插件的 text 中，未知 marker 仍是普通文本。成功后 Blue 用最终 text 加原顺序 image block 组装请求；follow-up 失败或安全撤回会恢复尚未消费的附件。

所有 callback context 都以 contribution id 作为 `surfaceId`。`revision` 只在当前 editor runtime generation 内单调，runtime/theme 重载后可以重新计数；它只用于关联 owner 当前工作，不是持久 host revision。`userGesture` 只提供给 `onEvent`，completion 与 submit transform 永远不会收到。

插件必须观察 `context.signal` 并尽快停止工作。Blue 仍有 owner 侧 deadline 作为兜底：补全 5 秒，action 与 submit transform 30 秒；deadline 不是继续执行后台副作用的许可。
