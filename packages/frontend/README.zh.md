# `@dsh-blue/blue-frontend`

[English](README.md) | 中文

Renderer-neutral 的 frontend runtime：readonly 交互模型、registry 与 provider host。模型是纯不可变数据——view、list、panel、status、dock、notification、editor、tool presentation 与 transcript entry——以结构化 `Action` 载荷代替回调。任何模型都不含 pi-tui、React/DOM、ANSI、终端宽度、focus handle、renderer 键绑定、Promise 或 Harness Agent/Session 对象；由 renderer adapter 把它们编译为具体组件。

- `FrontendHost` 持有当前 provider，宿主本身在换装期间持续存活。每次换装串行执行 capture → abort → dispose → activate → restore；激活失败回退到内置 `plainProvider`，不影响 Agent loop，迟到的发布按 generation 丢弃。
- `blueThemeModels`（`ThemeModelService`）是语义主题 registry：不可变 token 表，提供激活与订阅。Renderer adapter 注册模型并随其 Fiber 释放。
- `blueNotifications`（`NotificationModelService`）是带 dedupe key 的 renderer-neutral 通知 registry；以 toast、status 还是 log 呈现由 renderer 决定。

本包是 domain 包：不含任何 TUI、终端或 renderer 代码。
