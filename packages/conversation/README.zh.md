# @dsh-blue/blue-conversation

供 Blue 前端模型使用的 Harness 原生、renderer-neutral 会话投影。它注册 `blueConversation` session projection，并在 replay、resume、流式输出、工具、图片、失败和中断场景中保留 append-origin 的人类转录历史。安全撤回 prompt 时会删除被撤回 turn 的全部内容，并屏蔽该 turn 的迟到事件。

注册完成后，它发布 effect-scoped 的 `blueConversationReady` 加载顺序信号，使 consumer 只会在投影回放就绪后读取恢复会话的首个快照。卸载插件会同时移除投影和该信号。

这是 domain 包：不包含 TUI、终端、React、DOM，也不向前端暴露 Agent 或 Session。
