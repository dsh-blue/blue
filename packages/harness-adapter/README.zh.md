# `@dsh-blue/blue-harness-adapter`

F2 Harness 兼容适配层，将文档化 Harness 能力转换为 Blue 的 renderer-neutral runtime。session、projection、action、model、question/approval bridge 可独立卸载；缺失能力、abort 和 stale result 均返回结构化结果，不暴露原始 Agent 或 Session 对象。
