# 创造模式实战：从会话原型到可分发插件

创造模式（agent preset `cordis`）适合把一个想法先做成当前会话可见的动态原型，再在验收后决定是否持久化。它不是修改 Blue 源码的快捷入口：动态插件只存在于当前 dsh 进程，重启后会消失；需要长期维护的功能必须最终落成普通 npm 插件包。

## 先确定生命周期

创造模式推荐遵循下面的顺序：

```text
澄清需求 → inspect 了解可用服务 → cordis_define 定义 → cordis_run 热挂载
       → 在当前会话迭代并验收 → 选择持久化方式 → 打包、验证、发布
```

原型阶段使用 `cordis-plugin-development` skill。它要求先通过 `cordis_inspect_list` 和 `cordis_inspect_query` 读取真实的 Provider、Service、Event 和 Tool 形状，再写 `code.host`；`cordis_define` 只保存一个不可变 Package，`cordis_run` 才会激活它。需要改版时追加新 Package 并用 `update` 切换，失败时用 `inspect_self` 查看诊断，不能覆盖旧版本。

用户验收原型后，再加载 `blue-plugin-development` skill，把它转换为可分发的包。持久化前必须明确选择：保留本地包、上传 GitHub、发布 npm，或有意保持临时原型。临时原型不会自动写入仓库，也不会在重启后保留。

## Blue 插件的 Beta 边界

持久化插件是普通 ESM 包，最小结构如下：

```text
blue-feature/
  package.json          # type: module、main、dsh.bundle.patch
  index.js              # Cordis plugin entry
  cordis.patch.yml      # 把 entry 插入 profile
```

入口必须导出固定的 `name`、`inject` 和 `apply(ctx)`。Blue 功能通过 `ctx.bluePluginHost.open(ctx, manifest)` 申请当前 `1.0.0-beta.1` capability：`commands`、`status`、`panes`、`overlays`、`notifications.publish` 与只读的 `session.read`。Generic `session.act` 已移除，写操作继续使用所属 Harness service、command 或 feature action。`open()`、`register()`、`publish()` 都返回结构化 `BlueResult`，每次都要检查 `ok`。注册由调用方 Fiber 托管，插件卸载、更新或 profile 重载时会自动撤销。Editor/status provider 和 editor extension 仅保留为 Experimental/reference surface；候选注册保持 inert，只有 settings 选中的 id 才会激活。

插件只能返回 renderer-neutral 的 `BlueUiNode`/`BlueView` 和结构化 action：

- 不得 import `pi-tui`、拼接 ANSI 行或自行计算终端宽度；
- 不得访问 `blueScreen`、`blueComponents`、私有 status/bottom-pane registry 等 owner-only 服务；
- 不得保存 Agent/Session 实例或把业务状态放进 module singleton；
- 视图的宽度、主题、布局和降级由 Blue 核心适配器负责。

## 案例：blue-doudizhu

本节依据会话 `session-aad9fdb6-09ff-45b9-9aa0-0c7822efbcd5` 整理。目标是在 Blue 的 bottom pane 实现斗地主，并最终形成可分发的 npm 包。

### 1. 在会话中原型化

最初需求包括字符牌面、清晰的回合提示、单人 Bot、多人与服务端连接，以及通过命令出牌。会话先选择 `cordis` 创造模式并加载 `cordis-plugin-development`，通过 inspect 查询了动态插件和本地 LLM 服务，然后用 `cordis_define` 创建 `blue-doudizhu`，用 `cordis_run` 热挂载到当前会话。

原型只依赖公开 Blue facade：

```js
return {
  name: 'blue-doudizhu',
  inject: ['bluePluginHost'],
  apply(ctx) {
    const opened = ctx.bluePluginHost.open(ctx, {
      id: 'com.example.blue-doudizhu',
      api: '^1.0.0-beta.1',
      capabilities: ['commands', 'panes', 'notifications.publish'],
    })
    if (!opened.ok) throw new Error(opened.code + ': ' + opened.message)
    opened.value.commands.register({ id: 'poker', label: '斗地主牌局', execute })
    opened.value.panes.register({
      id: 'doudizhu-board',
      priority: 30,
      placement: 'bottom',
      render: () => renderBoard(state),
    })
  },
}
```

Bot 复用宿主当前模型：插件通过 `ctx.get('agentDefaultModel')` 读取当前选择，再通过 `ctx.get('llm')` 发起流式请求；模型不可用或超时则回退到规则决策。这个做法保留了 Harness 的模型配置边界，没有复制 Agent 会话对象。

### 2. 根据实际反馈迭代

用户先要求说明玩法，随后反馈 Bot 不出牌、决策质量不足。会话中的多个 Package 版本依次修正了这些问题，并加入了：

1. 当前回合和胜负高亮；
2. 按地主/农民结算的积分与比赛结束排行榜；
3. thinking 流和 30 秒倒计时；
4. 可切换的记牌器；
5. `/poker pause` 收起面板但不结束比赛，`/poker resume` 恢复。

每次修改都用 `cordis_define` 追加不可变版本，再用 `cordis_run update` 激活；这保留了失败版本的诊断和回滚路径。只有用户明确提出“上传到 dsh-blue 组织并发布 npm”后，才加载 `blue-plugin-development`，创建 `package.json`、`index.js`、`cordis.patch.yml`，并推送到 GitHub。

### 3. 打包前的规范核对

`blue-doudizhu` 已符合以下核心形状：

- `name`、`inject: ['bluePluginHost']`、`apply(ctx)` 均为固定导出；
- manifest 只申请实际使用的 `commands`、`panes`、`notifications.publish`，没有多申请 session 能力；
- `/poker` 命令、底部面板和通知均通过 `open()` 返回的 capability API 注册；
- `cordis.patch.yml` 只插入 `blue-doudizhu` 这一行，卸载由 Fiber 自动清理；
- npm 包声明 `@deepseek-ai/cordis` 和 `@dsh-blue/blue` 为 peer dependency，并通过 `dsh.bundle.patch` 被 profile 装载。

仍有一项必须在发布前修正的兼容性问题：当前 `index.js` 自带 `charWidth`/`displayWidth`。这属于 Blue 明确禁止的手工宽度实现，CJK 和 emoji 可能与真实终端宽度不一致。应改为返回 renderer-neutral 内容，让 Blue 适配器测量和换行；修正后再做窄终端、CJK、emoji 的实际 profile 验证。

## 从原型到 npm

持久化后在 scratch profile 中迭代，不要污染生产 `blue` profile：

```sh
dsh plugin --profile blue-dev add /path/to/blue-doudizhu
dsh --profile blue-dev
```

发布前至少运行静态边界检查、打包安装 fixture、卸载检查和真实终端 dogfood。对第三方包可使用 `npm pack` 后在 throwaway profile 安装，确保 tarball 中包含入口和 `cordis.patch.yml`。只有这些检查和人工验收都通过，才发布 npm，并在 README 中同时写明 Blue 前置安装、profile 安装和重启步骤。

## 本案例是否真正使用了创造模式 skill？

是。会话记录显示实际调用了 `blue-plugin-development`（打包阶段）以及 `cordis-plugin-development`（动态原型、热挂载和多次更新），而不是只在文档中声称使用。文档中的流程、能力边界和版本切换规则均来自这些 skill 的约束，并与最终仓库形态逐项核对。
