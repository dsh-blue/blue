# `@dsh-blue/blue-transcript`

[English](README.md) | 中文

Blue 的 projection-backed transcript 以及 canonical status、tool、bottom-pane node 终端渲染器。本包是 renderer adapter：Harness domain state 在进入本包前已完成 projection，且只有 `@dsh-blue/blue-core` 接触 pi-tui。

## Transcript

`./official-model` 插件通过 app 所有的 `blueSessionProjections` 消费完整 `blueConversation` 值。它把 user、assistant、thinking、tool、error、interruption、image 与 retraction fact 映射为稳定的 renderer-neutral entry，并在 domain projection 之外解析官方 tool presentation。过期、畸形、异会话与卸载后的值都会被丢弃。

`TranscriptModelService` 按稳定 id 协调 semantic component，把每个 model 限制为最新 200 项，缓存稳定的已完成 frame，应用配置后的 turn window，只向最近若干 turn 转发 Ctrl-O 展开，并在条目退役时释放 timer。User message 折叠阈值、thinking/tool 默认展开状态、turn window 与展开范围都属于 frontend-tree-scoped presentation policy，因此 theme/provider reload 可保留设置，同时不同 tree 之间不会泄漏状态。

当前 runtime 不折叠 Harness session event，也没有旧 tool-intent registry。Generic、terminal、diff、search、read 与 web tool 形态通过 canonical projection/presentation model 到达渲染层，同时保留共享的状态、参数、命令与展开 chrome。BTW pane 与连接的 editor 共用对齐的左右边框，不再插入 spacer 行。

Blue 自有 banner、activity、长消息展开、图片、中断与展开键位 chrome 跟随当前英文或简体中文 locale。语言 revision 会原地失效 renderer cache 并重投影 keymap 文案；conversation 与 tool payload 保持原文。

Assistant Markdown 统一通过 core 的富文档 adapter 流式渲染。闭合的 `mermaid`
fence 会立即原位显示并在后续 token 到达时复用缓存；未闭合 fence 保持代码。
非法、超配额、超宽、含 CJK 或 emoji 的图保留原始源码 fence。

## Status 与 Bottom Pane

主插件拥有五个 renderer bridge：

- 包内私有的 `BlueStatusEntryService` 为内建两行 footer 收集 canonical `BlueStatusNode` contribution。
- `BlueStatusCompositionService` 在该 `blue.default` footer 与一个用户选中的 status-provider candidate 之间选择渲染。
- 包内私有的 `BlueBottomPaneService` 按 priority 与 id 排列有界的 Blue-owned bottom pane；它没有 left/right lane。
- `BlueModelToolService` 把官方 tool presentation fact 转换为 canonical `BlueUiNode` call/result，并直接通过 core 编译。
- `TranscriptModelService` 渲染官方 semantic conversation model。

Footer 子插件以 canonical status node 提供 model、cwd、git、title、context 与 session mode 信息。Activity、todo 与 agents pane 通过 `blueSessionFacts` 消费 `blueConversationFacts` projection；BTW pane 通过 `blueSessionActions` 获取可释放的旁路会话并渲染其官方 conversation projection。Activity 轮换只介绍稳定的命令与功能，不复制随焦点变化的按键教学；这些上下文提示归当前活动 pane/overlay 所有。Todo 的 Ctrl-T 展开文案、BTW 的关闭/滚动文案与 Ctrl-O 折叠行仍留在局部，因为它们描述的就是该 renderer 隐藏的内容。在 canonical vocabulary 能精确表达之前，activity、todo、agents、BTW 与 queue 的高级 chrome 保留在有 width 边界的 renderer adapter 后。任何 pane 都不会接收 Agent 或 Session。

`./status-provider-owner` 宣告 `status.provider`，并跟随持久化的 `blue.statusProvider` id。Candidate 在被选择前保持 inert。选中 callback 只会收到冻结的公共 session snapshot、已清洗的可见 additive entry 与 busy 标志；Blue 会先在 footer 实际宽度下完成编译和 dry-render，再激活它。非法、零行、超过三行或失败的输出不能替换同一会话中正常工作的 provider；首次激活失败或 session 切换使用 `blue.default`，滚动 60 秒内三次失败会打开无定时器 breaker。Blue 不会改写缺失或失败的 desired id。

`./plugin-host-bridge` 是第三方 renderer-neutral additive status contribution 的 owner adapter。只有其 Fiber 存活时才会宣告 `status`；替换后的 bridge 会从 host snapshot 恢复仍由公开 API 持有的 contribution。Bridge 跟随 status-local revision，因此获准的 refresh 会失效已有 entry，而不会重建无关 provider。初始及刷新阶段的插件 render failure（包括 hostile thrown value）都会变成有界 danger entry，无法压制 sibling status row 或默认 footer。公共 pane 与 overlay 由 core 的 canonical surface bridge 持有。所有 registration 与 subscription 都绑定 Fiber，并在 unload 时移除。

## 其他子路径

`./banner` 挂载欢迎横幅；`./banner-content` 导出横幅显示的 `BLUE_VERSION` 常量，与 `package.json` 保持同步。`./status-basic-model`、`./status-cwd`、`./status-title`、`./status-git` 与 `./status-context` 发布 canonical footer node；`./status-provider-owner` 拥有独占 provider 选择。`./pane-activity`、`./pane-todo`、`./pane-btw` 与 `./pane-agents` 发布 canonical bottom-pane node。`./tool-model` 导出 `toolCallNode`/`toolResultNode` 和 canonical tool registry；`./transcript-model` 提供 renderer-neutral transcript registry。Bottom-pane service 有意不作为 subpath 导出。

所有渲染行都遵守 core 的 visible-width 契约，包括窄窗口与 CJK viewport。通用行裁剪与 BTW 顶边框都通过窄化的 `blueComponents` renderer 操作完成；transcript 不导入 core 私有 chrome 算法。

## 模型体验

无。本包只渲染已有 projection 值，不添加 prompt 或 request prefix。
