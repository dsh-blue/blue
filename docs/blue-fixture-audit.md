# External Fixture Audit

本文记录外部插件如何验证 Blue 目标架构；不把“可迁移”误写成“已迁移”。

## [dsh-remote](https://github.com/GeekCmore/dsh-remote)

`dsh-remote` 已按 shared core、backend、client、proxy、frontend、bundle 拆分，提供 live/daemon 两种模式、capability negotiation、seq-cursor resume、write lease、approval/question bridge 和 daemon-TUI bundle。

验证重点：session runtime、attach/detach、remote proxy、action 转发、多 session scope、headless 与 TUI 共用 domain 能力。它应作为第二条垂直 fixture，而不是第一个 UI 迁移样例。

## [dsh-context](https://github.com/bowenliang123/dsh-context)

验证链路：Harness context/token-meter domain -> projection -> `/context` command/action -> panel/status interaction model -> Blue TUI renderer。重点检查 replay/resume、projection watermark、缺能力降级、Fiber unload、窄终端和 fixture snapshot。

## [dsh-openpencil](https://github.com/ZSeven-W/dsh-openpencil)

Domain 包含工具、签名 capability、事务性 batch action 和文件生命周期；交互/renderer 包含多帧预览、Web canvas 和 managed editor。Blue 迁移目标是提供文本/摘要 fallback，不复制 Web canvas；headless domain 能力必须独立可用。

## [dsh-lark](https://github.com/sugarforever/dsh-lark)

验证外部系统 action、notification、credentials/config 和无 TUI domain 使用。Blue adapter 只负责将结果映射到 command/notification model。

## 统一审计字段

后续每个 fixture 都记录 Domain、Projection、Action、Command、Interaction model、Renderer-specific UI、Bundle rows、scope、依赖、迁移风险和验证场景。
