# Blue 文档索引

当前实现事实以代码、[blue-architecture.md](./blue-architecture.md)、[blue-seams.md](./blue-seams.md) 和包级 `AGENTS.md` 为准；插件 v1 目标以 [blue-plugin-contract-v1.md](./blue-plugin-contract-v1.md) 为准；PR #77 的收敛状态和 v1 发布顺序分别以 convergence matrix 与 roadmap 为准。`history/` 和阶段设计文档只保留设计理由，不具有规范性。仓库约定见根 [AGENTS.md](../AGENTS.md)。

## 规范与目标态

| 文档 | 内容 |
|---|---|
| [blue-plugin-contract-v1.md](./blue-plugin-contract-v1.md) | Draft Target：Blue 插件 v1 的规范性契约；不代表全部接口已落地 |

## 当前实现

| 文档 | 内容 |
|---|---|
| [blue-architecture.md](./blue-architecture.md) | 当前架构：domain/projection/action/frontend model/TUI adapter 与 composition |
| [blue-seams.md](./blue-seams.md) | 当前 seam：稳定 plugin host、app session boundary、model registries 与 bundle mapping |
| [blue-session-runtime.md](./blue-session-runtime.md) | projection、action、session reader 与 adapter 职责 |
| [blue-interaction-model.md](./blue-interaction-model.md) | command、panel、status、dock、editor 与 provider model |
| [blue-surface-migration-matrix.md](./blue-surface-migration-matrix.md) | surface replacement 与物理删除状态 |
| [blue-plugin-validation.md](./blue-plugin-validation.md) | architecture validator 和独立 fixture 门禁 |
| [blue-fixture-audit.md](./blue-fixture-audit.md) | context/remote/openpencil/lark 验证记录 |

## 活跃收敛与发布

| 文档 | 内容 |
|---|---|
| [blue-pr77-convergence-matrix.md](./blue-pr77-convergence-matrix.md) | Active Control：PR #77 相对 v1 目标的处理结论、证据与合并门禁 |
| [blue-plugin-api-v1-roadmap.md](./blue-plugin-api-v1-roadmap.md) | Active Plan：PR #77 合并后到 v1 API 发布的产物顺序与退出条件 |
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

`history/` 保留归档时点原貌。`packages/context`、`packages/remote`、`packages/openpencil` 和 `packages/lark` 是 validation-only packages，不进入 Blue bundle/release closure。正式 package contract 由 `script/package-contract.mjs` 定义。
