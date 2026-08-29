# Blue 文档索引

当前实现事实以代码、[blue-architecture.md](./blue-architecture.md)、[blue-seams.md](./blue-seams.md) 和包级 `AGENTS.md` 为准；插件 v1 的机器/API 目标以 [blue-plugin-contract-v1.md](./blue-plugin-contract-v1.md) 为准，内部 owner 权限与重载行为以 [blue-plugin-host-lifecycle.md](./blue-plugin-host-lifecycle.md) 为准。[PR #79 / PR #77 合并手册](./blue-pr77-convergence-matrix.md)是从 docs-only 设计基线、PR #77 Beta 合并到后续独立 PR 的执行入口；[roadmap](./blue-plugin-api-v1-roadmap.md)定义阶段出口。PR #79 不发布 runtime、npm package、Website v1 可用性或作者 skill。插件作者的正式入口将在 Public Beta 后由 website「开发手册」承担，不需要先读仓内设计规范。`history/` 和阶段设计文档只保留设计理由，不具有规范性。仓库约定见根 [AGENTS.md](../AGENTS.md)。

## v1 设计规范

| 文档 | 内容 |
|---|---|
| [blue-plugin-contract-v1.md](./blue-plugin-contract-v1.md) | Draft Design Source：manifest、七项 Stable capability、版本与发布门；不代表全部接口已落地 |
| [blue-plugin-host-lifecycle.md](./blue-plugin-host-lifecycle.md) | Draft Internal：control-plane authority、owner generation、registration restore 与 hostile-sibling 边界 |

## 当前实现

| 文档 | 内容 |
|---|---|
| [blue-architecture.md](./blue-architecture.md) | 当前架构：domain/projection/action/frontend model/TUI adapter 与 composition |
| [blue-seams.md](./blue-seams.md) | 当前 seam：Beta plugin host、app session boundary、model registries 与 bundle mapping |
| [blue-session-runtime.md](./blue-session-runtime.md) | projection、action、session reader 与 adapter 职责 |
| [blue-interaction-model.md](./blue-interaction-model.md) | command、panel、canonical status/pane、editor 与 provider contract |
| [blue-surface-migration-matrix.md](./blue-surface-migration-matrix.md) | surface replacement 与物理删除状态 |
| [blue-plugin-validation.md](./blue-plugin-validation.md) | architecture validator 和独立 fixture 门禁 |
| [blue-fixture-audit.md](./blue-fixture-audit.md) | context/remote/openpencil/lark 验证记录 |

## 活跃收敛与发布

| 文档 | 内容 |
|---|---|
| [blue-pr77-convergence-matrix.md](./blue-pr77-convergence-matrix.md) | Active Handbook：PR #79 发布边界、PR #77 合并 runbook、P1-P9 独立 PR 队列与证据模板 |
| [blue-plugin-api-v1-roadmap.md](./blue-plugin-api-v1-roadmap.md) | Active Plan：R0-R6 阶段依赖、并行工作流与最终发布门 |
| [blue-compatibility-and-rollout.md](./blue-compatibility-and-rollout.md) | Harness 兼容窗口、fallback 与 rollout |

## 阶段设计、研究与历史决策

以下文件仍在顶层以保留现有链接；它们记录阶段方案或研究输入，不覆盖上面的目标契约和当前实现事实。

| 文档 | 内容 |
|---|---|
| [blue-frontend-architecture.md](./blue-frontend-architecture.md) | renderer-neutral frontend runtime 的架构原则 |
| [blue-runtime-cutover-ledger.md](./blue-runtime-cutover-ledger.md) | frozen refs、parity、删除门禁和最终证据 |
| [blue-frontend-runtime-cutover-spec.md](./blue-frontend-runtime-cutover-spec.md) | cutover 冻结规格和发布边界 |
| [blue-frontend-runtime-migration-checklist.md](./blue-frontend-runtime-migration-checklist.md) | C0-C7 执行/验收清单 |
| [blue-implementation-plan.md](./blue-implementation-plan.md) | F0-F6 阶段实施与兼容策略 |
| [blue-plugin-ecosystem.md](./blue-plugin-ecosystem.md) | 外部插件分类、安装与 provider lifecycle |
| [blue-skills-plan.md](./blue-skills-plan.md) | plugin development/migration/fixture/validation skills |
| [blue-api-design.md](./blue-api-design.md) | 早期公共 API foundation；由 v1 target contract 接替 |
| [blue-editor-walkthrough.md](./blue-editor-walkthrough.md) | editor contract/implementation/consumer/enhancement 走查 |
| [blue-roadmap.md](./blue-roadmap.md) | 阶段路线图；早期 seam 名称是历史记录，以当前架构文档为准 |
| [blue-commands-plan.md](./blue-commands-plan.md) | 内置命令实施记录；旧 `blueSession`/`fold.ts` 描述是当时方案 |
| [blue-decisions.md](./blue-decisions.md) | ADR 历史；被 cutover 取代的接口不再代表当前代码 |
| [blue-frontend-runtime-task-checklist.md](./blue-frontend-runtime-task-checklist.md) | F3-F6 已执行任务记录 |
| [blue-ui-component-enhancement.md](./blue-ui-component-enhancement.md) | `0.1.1-rc.1` UI 架构蓝图：公开 UI Kit、声明式节点、surface/plugin provider API、组件迁移与 Agent 实施门禁 |

`history/` 保留归档时点原貌。`packages/context`、`packages/remote`、`packages/openpencil` 和 `packages/lark` 是 validation-only packages，不进入 Blue bundle/release closure。正式 package contract 由 `script/package-contract.mjs` 定义。
