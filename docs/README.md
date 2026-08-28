# Blue 文档索引

本目录分为**当前文档**和 `history/` **历史存档**。当前文档随代码演进；历史存档保留归档时点原貌。包级细节见各 `packages/*/AGENTS.md`，仓库约定见根 [AGENTS.md](../AGENTS.md)。

## 当前架构与迁移控制

| 文档 | 内容 |
|---|---|
| [blue-architecture.md](./blue-architecture.md) | 当前架构：domain/projection/action/frontend model/TUI adapter 与 composition |
| [blue-seams.md](./blue-seams.md) | 当前 seam：稳定 plugin host、app session boundary、model registries 与 bundle mapping |
| [blue-frontend-architecture.md](./blue-frontend-architecture.md) | renderer-neutral frontend runtime 的目标原则 |
| [blue-session-runtime.md](./blue-session-runtime.md) | projection、action、session reader 与 adapter 职责 |
| [blue-interaction-model.md](./blue-interaction-model.md) | command、panel、status、dock、editor 与 provider model |
| [blue-surface-migration-matrix.md](./blue-surface-migration-matrix.md) | surface replacement 与物理删除状态 |
| [blue-runtime-cutover-ledger.md](./blue-runtime-cutover-ledger.md) | frozen refs、parity、删除门禁和最终证据 |
| [blue-frontend-runtime-cutover-spec.md](./blue-frontend-runtime-cutover-spec.md) | cutover 冻结规格和发布边界 |
| [blue-frontend-runtime-migration-checklist.md](./blue-frontend-runtime-migration-checklist.md) | C0-C7 执行/验收清单 |
| [blue-implementation-plan.md](./blue-implementation-plan.md) | F0-F6 阶段实施与兼容策略 |
| [blue-compatibility-and-rollout.md](./blue-compatibility-and-rollout.md) | Harness 兼容窗口、fallback 与 rollout |
| [blue-upstream-0.1.2-interface-alignment.md](./blue-upstream-0.1.2-interface-alignment.md) | 上游 0.1.2-alpha.1 接口对齐预研：逐接口 adopt/keep/verify 判定与跟发核对单 |
| [blue-plugin-validation.md](./blue-plugin-validation.md) | architecture validator 和独立 fixture 门禁 |
| [blue-fixture-audit.md](./blue-fixture-audit.md) | context/remote/openpencil/lark 验证记录 |
| [blue-plugin-ecosystem.md](./blue-plugin-ecosystem.md) | 外部插件分类、安装与 provider lifecycle |
| [blue-skills-plan.md](./blue-skills-plan.md) | plugin development/migration/fixture/validation skills |

## 产品与历史决策

| 文档 | 内容 |
|---|---|
| [blue-api-design.md](./blue-api-design.md) | 公共 API 设计 |
| [blue-editor-walkthrough.md](./blue-editor-walkthrough.md) | editor contract/implementation/consumer/enhancement 走查 |
| [blue-roadmap.md](./blue-roadmap.md) | 阶段路线图；早期 seam 名称是历史记录，以当前架构文档为准 |
| [blue-commands-plan.md](./blue-commands-plan.md) | 内置命令实施记录；旧 `blueSession`/`fold.ts` 描述是当时方案 |
| [blue-decisions.md](./blue-decisions.md) | ADR 历史；被 cutover 取代的接口不再代表当前代码 |
| [blue-frontend-runtime-task-checklist.md](./blue-frontend-runtime-task-checklist.md) | F3-F6 已执行任务记录 |

`packages/context`、`packages/remote`、`packages/openpencil` 和 `packages/lark` 是 validation-only packages，不进入 Blue bundle/release closure。正式 package contract 由 `script/package-contract.mjs` 定义。
