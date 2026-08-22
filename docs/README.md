# Blue 文档索引

本目录按**在用 / 历史存档**两层组织：在用文档随代码演进持续改写（描述现状）；历史存档（`history/`）是已完成阶段的设计与调研记录，正文保持归档时点原貌、不改写，各文件文首的归档说明给出落地去向与更正。包级实现细节见各 `packages/*/AGENTS.md`，仓库级约定见根 [AGENTS.md](../AGENTS.md)。

## 在用

| 文档 | 内容 |
|---|---|
| [blue-architecture.md](./blue-architecture.md) | 架构蓝图：分层、包职责与依赖方向 |
| [blue-api-design.md](./blue-api-design.md) | 公共 API 与可替换 UI 改进设计 |
| [blue-roadmap.md](./blue-roadmap.md) | 路线图与「预览版发版冲刺」排期、挂起区 |
| [blue-seams.md](./blue-seams.md) | 缝目录：当前代码开了哪些缝、契约与 plain 默认（现状正典） |
| [blue-editor-walkthrough.md](./blue-editor-walkthrough.md) | Editor 缝实例走查：契约/实现/消费/增强四角色逐层走查（自 README 抽出全文） |
| [blue-decisions.md](./blue-decisions.md) | ADR 决策记录（D1-D38，按主题分组，编号稳定不回收） |
| [blue-commands-plan.md](./blue-commands-plan.md) | 内置命令实施清单：四家参照系合并、能力支撑矩阵、S23-S29 分期（S29 待实施；§1.3 是 p1-design §4.3 判定的更正正典） |
| [blue-frontend-architecture.md](./blue-frontend-architecture.md) | 新目标架构：Harness domain、frontend runtime、TUI kernel 与 renderer 的边界 |
| [blue-session-runtime.md](./blue-session-runtime.md) | projection、action、session binding 与兼容 adapter 的目标职责 |
| [blue-interaction-model.md](./blue-interaction-model.md) | 不绑定 renderer 的 command、panel、status、dock 与 provider 模型 |
| [blue-plugin-ecosystem.md](./blue-plugin-ecosystem.md) | 外部插件分类、bundle/profile 安装与运行时热插拔 |
| [blue-compatibility-and-rollout.md](./blue-compatibility-and-rollout.md) | 主分支演进、Harness 兼容窗口、新旧实现共存与迁移门禁 |
| [blue-fixture-audit.md](./blue-fixture-audit.md) | dsh-remote、dsh-context、dsh-openpencil、dsh-lark 的迁移审计与验证计划 |
| [blue-skills-plan.md](./blue-skills-plan.md) | 插件开发与迁移 skills 的输入、诊断输出和实施顺序 |

图源约定：架构分层与 bundle 组合两张 mermaid 图的单一来源在 [diagrams/](./diagrams/)（`.mmd`）；README（中英）与 blue-architecture.md 中的嵌入块由 `pnpm run diagrams:sync` 生成，CI 以 `pnpm run diagrams:check` 把关一致性——改图请改 `.mmd` 源，不要手改嵌入块。

## 历史存档（history/）

| 文档 | 内容 |
|---|---|
| [history/blue-mvp-plan.md](./history/blue-mvp-plan.md) | MVP（Phase 0）实施计划——2026-08-18 验收完成 |
| [history/blue-p1-design.md](./history/blue-p1-design.md) | P1 分层设计（S0-S9）——已全部落地；§4.3 判定更正见文首归档说明 |
| [history/blue-p2-visual-design.md](./history/blue-p2-visual-design.md) | P2 视觉设计（S10-S21）——已全部落地；§8 两行被推翻见文首归档说明 |
| [history/blue-survey-pi-tui.md](./history/blue-survey-pi-tui.md) | pi-tui 0.84.2 选型调研存档 |
| [history/blue-survey-harness.md](./history/blue-survey-harness.md) | deepseek-harness 0.1.0-rc.7 调研存档 |
