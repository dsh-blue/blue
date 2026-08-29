# Blue 前端目标架构

> 状态：已落地的架构原则，2026-08。当前实现与剩余删除门禁以 `blue-architecture.md`、`blue-seams.md`、`blue-runtime-cutover-ledger.md` 和包级 `AGENTS.md` 为准。

## 目标

Blue 负责把 Harness 的 Agent 能力变成可替换、可维护的交互式前端。TUI 是第一种 renderer，但不是 Agent 能力的所有者；同一 domain 插件应能在 TUI、Web 或 headless 环境复用。

```text
Harness domain -> Blue frontend runtime -> renderer adapter -> terminal/DOM
```

Harness 继续拥有 Agent、Session、工具、持久化、权限、模型路由和公开事件/服务。Blue 不维护第二套 Agent 真相，只提供 renderer-neutral interaction model、TUI kernel 和组合层。

## 四类插件

| 类型 | 拥有 | 依赖 | 例子 |
|---|---|---|---|
| Domain | service、tool、projection、action、业务 command | Harness | context、remote、OpenPencil domain |
| Interaction | command/panel/status/pane/overlay/provider model | Harness domain + `blue-frontend` | `/context`、model selector |
| Renderer | layout、focus、input、视觉呈现 | frontend model + renderer kernel | Blue TUI |
| Composition | bundle、preset、启停、重排 | Cordis Loader | `cordis.patch.yml` |

官方包可以暂时把多个类型放在一个仓库，但公共契约和 Fiber 所有权必须按类型分开。

## Scope 规则

- **host**：跨 session 的 registry/service，例如模型、凭据、MCP、subagent 查询。
- **agent**：一个 Agent 拥有的 tools、persona、prompt 和 preset 组合。
- **session**：一个持久化 session 的 projection 和 action 状态。
- **frontend tree**：当前选中 session、draft、focus、panel stack 和 active provider。
- **provider Fiber**：provider 自己的订阅、timer、缓存和异步任务。

当前 status provider 实现把持久化的期望 id 留在 `blue` settings，把候选
registry 留在 host，把 active/last-known-good/breaker 状态留在 frontend tree；
候选 callback 仅在被选择后由 composition owner 调用。Provider Fiber 卸载只
撤销候选与自身资源，不改写用户的期望 id。

产品级可变状态不得放在模块 singleton。renderer 对象不得进入 host/session scope；frontend binding 不能成为 session 事实来源。

## TUI Kernel 边界

`blue-core` 仍是唯一接触 pi-tui 和 raw terminal 的包，拥有 terminal lifecycle、frame scheduling、width truth、layout、focus、key routing、overlay/editor slot、theme 编译和 render error boundary。

Status 编译边界除安全错误行外，还向 composition owner 报告当前帧已收容的
runtime failure；这只用于 dry-render、原子切换和 breaker，不把 renderer
异常或对象写入公共 snapshot。

Kernel 不知道 Agent、SessionEvent、工具语义或命令业务。插件贡献 readonly model 和 action，而不是 pi-tui component。现有 `blueScreen`、`blueKeymap`、`blueComponents` 可作为内部 TUI kernel seam；公共 frontend API 不透传这些类型。

## 目标包形态

```text
@dsh-blue/blue-api
  通用 manifest、BlueResult、基础 readonly 数据

@dsh-blue/blue-frontend
  interaction model、frontend host、provider contract

@dsh-blue/blue-core
  TUI kernel 与 pi-tui adapter

blue-harness-adapter
  独立、按能力拆分的 Harness -> Blue 兼容插件
```

`blue-frontend` 首期属于 Extension/Internal，不立即承诺 Stable v1；经过外部 fixture、卸载、替换和双版本兼容验证后再冻结。

## 数据流

```text
Harness event/service
  -> adapter 或原生 projection
  -> session projection/action runtime
  -> interaction model
  -> TUI renderer
  -> requestRender()
```

UI 不直接折叠 Harness event。事件表达事实，projection 表达当前状态，action 表达带结果的写请求。

## 迁移纪律

旧实现先保留为行为基线；新实现按 vertical slice 接入。一个 slice 必须同时有 domain/adapter、interaction model、TUI renderer、headless fixture、unload 测试和现有 golden/e2e 对比，之后才能替换旧 provider。
