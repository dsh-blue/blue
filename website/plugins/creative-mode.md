# 创造模式实战：从会话原型到可分发插件

创造模式（agent preset `cordis`）适合把一个想法先做成当前会话可见的动态原型，再在验收后决定是否持久化。它不是修改 Blue 源码的快捷入口：动态插件只存在于当前 dsh 进程，重启后会消失；需要长期维护的功能必须最终落成普通 npm 插件包。

::: warning 本页不是 P5 已交付声明
下面的斗地主案例记录的是早期 transition lane。`0.1.1-rc.2` 已完成 P1–P4，但
P5 的正式 `blue-plugin-development` skill、免克隆作者命令与持久包生成闭环尚未
交付；该案例不能作为 canonical rc.2 conformance 证据。
:::

## 先确定生命周期

创造模式推荐遵循下面的顺序：

```text
澄清需求 → inspect 了解可用服务 → cordis_define 定义 → cordis_run 热挂载
       → 在当前会话迭代并验收 → 选择持久化方式 → 打包、验证、发布
```

原型阶段使用 `cordis-plugin-development` skill。它要求先通过 `cordis_inspect_list` 和 `cordis_inspect_query` 读取真实的 Provider、Service、Event 和 Tool 形状，再写 `code.host`；`cordis_define` 只保存一个不可变 Package，`cordis_run` 才会激活它。需要改版时追加新 Package 并用 `update` 切换，失败时用 `inspect_self` 查看诊断，不能覆盖旧版本。

用户验收原型后，本 RC 需要按[快速开始](/plugins/quickstart)手工创建 canonical 包，
再从 Blue checkout 运行 validator 与 packed fixture。持久化前仍须明确选择：保留
本地包、上传 GitHub、发布 npm，或有意保持临时原型。P5 会把这段流程收口为正式
`blue-plugin-development` skill；当前原型不会自动写入仓库，也不会在重启后保留。

## Blue 插件的 Beta 边界

持久化插件是普通 ESM 包，最小结构如下：

```text
blue-feature/
  package.json          # type: module、exports、blue.manifest、dsh.bundle.patch
  blue.plugin.json      # P1 canonical manifest
  index.js              # Cordis plugin entry
  cordis.patch.yml      # 把 entry 插入 profile
```

入口必须导出固定的 `name`、`inject` 和 `apply(ctx)`，解析 package root 的 canonical
manifest，再把它传给 `ctx.bluePluginHost.open(ctx, manifest)`。当前 `1.0.0-beta.1`
开放 `commands`、`status`、`panes`、`overlays`、`notifications.publish`，以及只读
`session.read` 与 `session.projections.read`；后两项必须声明 exact field/key resource。
Generic `session.act` 已移除。`open()` 返回 `api`、exact `grants` 和
`unavailableOptional`，后续 `register()`、`publish()` 与 read 的每个 `BlueResult` 都要
检查。Editor/status provider 和 editor extension 只存在于旧 inline
Experimental/reference lane，不能写进 canonical manifest。

插件只能返回 renderer-neutral 的 `BlueUiNode`/`BlueView` 和结构化 action：

- 不得 import `pi-tui`、拼接 ANSI 行或自行计算终端宽度；
- 不得访问 `blueScreen`、`blueComponents`、私有 status/bottom-pane registry 等 owner-only 服务；
- 不得保存 Agent/Session 实例或把业务状态放进 module singleton；
- 视图的宽度、主题、布局和降级由 Blue 核心适配器负责。

## 案例：blue-doudizhu

本节依据会话 `session-aad9fdb6-09ff-45b9-9aa0-0c7822efbcd5` 整理。目标是在 Blue 的 bottom pane 实现斗地主，并最终形成可分发的 npm 包。

### 1. 在会话中原型化

最初需求包括字符牌面、清晰的回合提示、单人 Bot、多人与服务端连接，以及通过命令出牌。会话先选择 `cordis` 创造模式并加载 `cordis-plugin-development`，通过 inspect 查询了动态插件和本地 LLM 服务，然后用 `cordis_define` 创建 `blue-doudizhu`，用 `cordis_run` 热挂载到当前会话。

原型当时只依赖公开 Blue facade，但使用的是旧 inline transition manifest。下段仅
用于解释历史会话，不是新插件模板；canonical 写法见[快速开始](/plugins/quickstart)：

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

每次修改都用 `cordis_define` 追加不可变版本，再用 `cordis_run update` 激活；这保留了失败版本的诊断和回滚路径。历史会话只在用户明确提出“上传到 dsh-blue 组织并发布 npm”后，才加载当时的早期 `blue-plugin-development`，创建旧版 package 并推送到 GitHub；这不是 P5 canonical 生成器。

### 3. 当前 rc.2 迁移缺口

市场中的 `blue-doudizhu@0.1.0` 仍声明旧 API 范围、flat capability，并调用已移除的
`dock` facade；源码还包含 `charWidth`/`displayWidth` 手工宽度实现。因此它目前不能
通过 P1 canonical validator，也不是 rc.2 可安装示例。恢复市场收录前至少需要：

- 增加 package discovery pointer 与完整 canonical `blue.plugin.json`；
- 把 `dock` 迁到 exact-placement `panes`，从 `opened.value.api` 取获准 facade；
- 删除手工宽度计算，交给 Blue UI/compiler，并完成 packed、窄宽度、真实 profile 与人工验收。

## 从原型到 npm

持久化后在 scratch profile 中迭代，不要污染生产 `blue` profile：

```sh
dsh plugin --profile blue-dev add /path/to/blue-doudizhu
dsh --profile blue-dev
```

发布前至少从 Blue checkout 运行静态边界检查、打包安装 fixture、卸载检查和真实
终端 dogfood。对第三方包使用 `npm pack` 后在 throwaway profile 安装，确保 tarball
包含入口、canonical manifest 与 `cordis.patch.yml`。免克隆命令属于 P5；在它发布
前，这些步骤仍是显式的 checkout-based 门禁。

## 本案例是否真正使用了创造模式 skill？

历史会话确实调用过同名的早期 `blue-plugin-development` 和
`cordis-plugin-development`，但那份记录早于 P1 canonical contract。它只证明动态
原型流程曾被实际使用，不代表 P5 的正式作者 skill、生成器或 conformance 闭环已交付。
