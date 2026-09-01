# 创造模式实战：从会话原型到可分发插件

创造模式（agent preset `blue-cordis`）适合把一个想法先做成当前会话可见的动态原型，再在验收后决定是否持久化。上游 `cordis` 保持原样，Blue 只维护这个唯一自定义 ID。动态插件只存在于当前 dsh 进程，重启后会消失；需要长期维护的功能必须最终落成普通 npm 插件包。

::: info P5 已交付，历史案例仍不是新模板
`0.1.2-alpha.1` 已提供正式 `blue-plugin-development` skill、发布的免 checkout 作者命令
与本地持久包闭环。下方斗地主案例早于 canonical contract，只用于解释原型迭代；
新包以 machine catalog、生成器和 conformance 结果为准。
:::

## 先确定生命周期

创造模式推荐遵循下面的顺序：

```text
澄清需求 -> inspect 了解可用服务 -> cordis_define -> cordis_run 热挂载
       -> 在当前会话迭代并验收 -> 选择 ephemeral/local/GitHub/npm
       -> catalog -> create/修改 -> validate -> 支持线 conformance -> 人工验收
```

原型阶段使用 `cordis-plugin-development` skill。它要求先通过 `cordis_inspect_list` 和 `cordis_inspect_query` 读取真实的 Provider、Service、Event 和 Tool 形状，再写 `code.host`；`cordis_define` 只保存一个不可变 Package，`cordis_run` 才会激活它。需要改版时追加新 Package 并用 `update` 切换，失败时用 `inspect_self` 查看诊断，不能覆盖旧版本。

用户验收原型后，加载正式 `blue-plugin-development` skill。它先要求用户明确选择保留
临时原型、本地包、GitHub 或 npm；“做成长期版本”不构成任何外部发布授权。选择本地包
后，skill 只使用发布的机器接口：

```sh
blue-plugin catalog --json
blue-plugin create ./my-plugin --name @acme/my-plugin
blue-plugin validate ./my-plugin
blue-plugin conformance ./my-plugin
blue-plugin conformance ./my-plugin --harness-line 0.1.2-alpha.2
```

若需求无法由 catalog 表达，skill 会停止写文件并输出 renderer-neutral capability
提案；它不会退回 Experimental surface、Blue private service 或 raw terminal。GitHub 与
npm 是本地包全绿后的两次独立授权，不由 prototype acceptance 推导。

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
manifest，再把它传给 `ctx.bluePluginHost.open(ctx, manifest)`。当前 `1.0.0-beta.2`
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

每次修改都用 `cordis_define` 追加不可变版本，再用 `cordis_run update` 激活；这保留了失败版本的诊断和回滚路径。历史会话只在用户明确提出“上传到 dsh-blue 组织并发布 npm”后，才加载当时的早期 `blue-plugin-development`，创建旧版 package 并推送到 GitHub；这不是当前 canonical 生成器，也不能替代 rc.3 的验证门。

### 3. 历史市场条目的迁移缺口

市场中的 `blue-doudizhu@0.1.0` 仍声明旧 API 范围、flat capability，并调用已移除的
`dock` facade；源码还包含 `charWidth`/`displayWidth` 手工宽度实现。因此它目前不能
通过 canonical validator，也不是 rc.3 可安装示例。恢复市场收录前至少需要：

- 增加 package discovery pointer 与完整 canonical `blue.plugin.json`；
- 把 `dock` 迁到 exact-placement `panes`，从 `opened.value.api` 取获准 facade；
- 删除手工宽度计算，交给 Blue UI/compiler，并完成 packed、窄宽度、真实 profile 与人工验收。

## 从原型到本地包，再决定是否发布

持久化后在 scratch profile 中迭代，不要污染生产 `blue` profile：

```sh
dsh plugin --profile blue-dev add /path/to/blue-doudizhu
dsh --profile blue-dev
```

进入 scratch profile 前先运行 `blue-plugin validate` 和唯一支持的 Harness
`0.1.2-alpha.2` `blue-plugin conformance`。通过后再安装本地目录，覆盖卸载、重启、120/80/40 列与
真实终端 dogfood。conformance 已用 script-disabled pack 检查 tarball 中的公开入口、
canonical manifest、`cordis.patch.yml` 和依赖闭包。

本地验收完成后，只有用户明确选择 GitHub 或 npm，agent 才能继续创建 repository、
commit/tag 或发布 artifact。插件市场保持暂停；本地持久化和直接精确来源安装不依赖
市场，也不意味着自动收录。

## 本案例是否真正使用了创造模式 skill？

历史会话确实调用过同名的早期 `blue-plugin-development` 和
`cordis-plugin-development`，但那份记录早于 canonical contract。当前 P5 交付由正式
skill 的四类 eval、发布 CLI 的 no-checkout pack gate、教程的支持线 conformance
和独立 profile 人工验收证明；斗地主历史本身仍不算这些证据。
