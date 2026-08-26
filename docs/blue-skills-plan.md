# Plugin Development And Migration Skills

## Plugin Development Skill

引导开发者先判定插件类型（Domain、Interaction、Renderer、Composition）和 scope（host、agent、session、frontend tree），再选择 service、registry、projection、action 或 provider。输出 package/bundle 拆分、Cordis rows、inject、capability、fallback、unload 和测试清单。

## Plugin Migration Skill

扫描现有插件的 pi-tui/React/DOM import、Agent/Session 直接访问、自行折叠 session event、module singleton、Web/domain 混合、bundle 隐含依赖和缺失 lifecycle 测试。输出可复用 Domain、待抽取 Interaction、renderer-specific 部分、所需 Blue adapter、拆包建议和风险。

## Plugin Fixture Skill

生成 headless、TUI、provider swap、unload、projection replay、action abort 和 width-scan 测试骨架。fixture 必须从独立安装包或 link bundle 加载，不能只从 Blue workspace 相对 import。

## 实施顺序

先用 `dsh-context` 迁移过程验证分类和诊断，再实现生成模板；用 `dsh-remote` 验证 session/remote adapter，最后用 `dsh-openpencil` 验证 renderer capability/fallback。

当前实现：四份可复用 skill 文档位于 `docs/skills/`；
`script/blue-plugin-validate.mjs` 执行边界、exports 和 lifecycle 静态审计，
`script/blue-plugin-fixture.mjs --install` 在临时目录打包、独立安装并
import 目标包，再输出 replay、abort、swap、width、unload 场景清单。
