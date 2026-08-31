# Blue 到 dsh 0.1.2 alpha 的迁移记录

> 目标版本：Blue `0.1.2-alpha.1`，DeepSeek Harness `0.1.2-alpha.2`。
> 本版本只支持这一条 Harness alpha 线；Harness RC 明确不在兼容范围内。

## 目标与边界

本次迁移把 Blue 的编译、运行、启动器、作者工具和文档统一到 Harness
`0.1.2-alpha.2`，并停止维护上游内置 preset 的本地副本。Blue 只保留唯一自定义
preset id `blue-cordis`；`standard`、`minimal`、`ptc`、`cordis` 全部由 Harness
shipped root 提供，旧 `code` alias 删除。

迁移不发布 npm 包、不兼容 Harness RC，也不把旧 RC 插件的 manifest 改写成
alpha 兼容。自动门禁通过后建立 Draft PR；专用 profile `blue-dsh-alpha` 和真人
终端验收完成前不转 Ready、不合并。

## 版本与依赖闭包

- 十二个发布包、Website 与公开 `BLUE_VERSION` 同步为 `0.1.2-alpha.1`。
- 所有运行时和开发期 `@deepseek-ai/dsh-*` 依赖精确钉到
  `0.1.2-alpha.2`；Harness peer 使用只覆盖该 prerelease 的约束。
- `@deepseek-ai/cordis`、`@deepseek-ai/loader`、`@deepseek-ai/include` 和
  `@deepseek-ai/schemastery` 分别跟进到 alpha.2 依赖图要求的 `4.0.2`、`1.0.3`、
  `1.0.7` 和 `3.18.2`。
- 根与 launcher runtime lockfile 重新解析，禁止残留已安装的
  `0.1.1-rc.2` Harness 实例；minimum-release-age exclude 跟随 alpha.2 完整闭包。
- 临时强制 `use-sync-external-store: 1.6.0`，避免 alpha.2 Web 闭包选中只声明
  React 18 peer 的 `1.2.0`，而同一闭包实际使用 React 19。
- launcher 内嵌 runtime、`/version`、fixture 默认线和机器 catalog 全部以
  `0.1.2-alpha.2` 为唯一版本真相。更新通道从 `rc` 切到 `alpha`。

## Harness API 适配

| 变化 | Blue 适配 |
|---|---|
| Settings section API | 从 `installSettingsSection/settingsNamespace` 改为在可选 `settings` capability 中调用 `settings.installSection`；无 settings 服务时继续使用 tree-scoped 默认值。 |
| User Questions | 从单 provider 注册改为监听 `user-questions/request` waterfall；Fiber unload 自动移除 answerer，未处理请求继续交给后续 answerer。 |
| Permission preset projection | `PermissionPresetService.current` 从 event 数组输入改为接收 live `Session`；只有 app domain boundary 可传入 Session，interaction model 仍只得到 preset id。 |
| Todo 类型导出 | `TodoItem` 改从 `@deepseek-ai/dsh-tool-todo` 根导出消费，conversation 与 transcript 不再从 session 包取类型。 |
| LLM tool call id | 测试和构造入口从 `CallId` 改为 `ToolCallId`。 |
| Locale/settings 生命周期 | adapter 跟随 alpha.2 的 settings scope 与更新事件，继续保留缺 capability 时的系统 locale fallback。 |
| Preset 内容 | `blue-cordis` 合入 alpha.2 shipped `cordis` 的 `command-goal`、subagent `modelSelectionSettings: true` 与 Web `fetch: true`。 |
| Preset Host 依赖 | 在 Host scope 挂载上游 `@deepseek-ai/dsh-tool-subagent/model-selection-settings`；否则 shipped `standard` 等 preset 的 delegation row 会拒绝挂载。 |

## Preset 组合策略

`cordis.patch.yml` 使用标准 `agent-presets` row，并同时开启
`includeShippedRoot` 与 `includeUserRoot`。第三个 system root 指向 Blue tarball 内的
`presets/`，其中只允许 `blue-cordis`：

```text
Harness shipped root: standard, minimal, ptc, cordis
Blue system root:     blue-cordis
User root:            user-owned presets
Effective built-ins:  standard, minimal, ptc, cordis, blue-cordis
```

测试同时锁定上述五个 id、`code` 不存在、Blue root 只有一个目录，以及
`blue-cordis` 含 alpha.2 新增 row/config。这样上游 preset 后续随精确 Harness
依赖升级，不再要求 Blue 复制和逐文件同步；唯一额外维护面是有独立产品语义和作者
skills 的 `blue-cordis`。Blue 仍需组合 shipped rows 明确要求的上游 Host capability；
当前 `subagent-model-selection-settings` row 直接复用 Harness 导出，不复制 preset
内容或其业务实现。

## 插件迁移记录

### Domain

Harness 继续拥有 Agent、Session、settings、question、todo、tool call 与 preset
语义。Blue 不复制这些业务状态；本次只调整公开导入和服务调用。

### Projection

`blue-conversation` 继续把官方 session projection 转换为 readonly conversation
facts。Todo 只更换类型来源，不改变 projection 的 epoch、sequence、replay 或
late-result fencing。

### Action

现有 app action owner 保持不变。Settings 写入仍委托 Harness settings section；
question 回答通过 alpha.2 waterfall 返回结果，不暴露 Agent/Session，也不引入新的
通用写 capability。

### Interaction Model

`/settings` 只展示 `alpha` 更新通道；`/version` 显示 Harness
`0.1.2-alpha.2`。Todo、questionnaire、provider onboarding 和 plugin catalog 保持
renderer-neutral model。固定的 `blue-doudizhu@0.3.0` snapshot 因只声明 RC
兼容而显示 `incompatible`，且不提供 install action。

### Renderer UI

没有新增 renderer API，pi-tui 与 terminal width 仍只由 `blue-core` 持有。现有
20/40/80/120 width scan、plain fallback 和 whole-tree TUI e2e 继续作为回归门禁。

### Composition Rows

`agent-presets` 改为上游 shipped/user root 加 Blue 唯一 root；base disable list
加入 alpha.2 的 `command-goal`，避免 host row 与 preset row 重复。Host scope 新增
上游 `subagent-model-selection-settings` provider，满足 shipped delegation rows 的
显式依赖；Cordis host runner 继续服务 shipped `cordis` 和 `blue-cordis`，creative
isolate 的 Blue service allowlist 不扩大。

### Scope

Settings source 仍属于 frontend tree；question answerer、preset provider、Cordis
runner 注册和所有订阅仍由各自 Fiber 管理。迁移不增加 module singleton，也不让
renderer 对象跨入 host、agent 或 session scope。

### Capabilities

机器 catalog 将 `supportedHarnessLines` 设为唯一数组
`['0.1.2-alpha.2']`。生成插件使用精确 Harness compatibility；conformance CLI
拒绝 RC 或其他未声明 line。Public Beta capability 名称与版本本次不变。

### Fallback

- 缺 settings 服务：使用 Blue 默认设置和系统 locale，不阻断 frontend tree。
- question waterfall 无 Blue UI answerer：请求继续交由后续 Harness answerer。
- 插件 capability 缺失或 provider 失败：保留 plain/default renderer provider。
- RC-only catalog entry：保留真实 metadata 供查看，但标记 incompatible 且不安装。
- `blue-cordis` 失败：上游 `standard/minimal/ptc/cordis` 仍由 shipped root 独立提供。

### Fixtures

- version、runtime、settings、questions、todo、preset 和 catalog 定向测试。
- bundle whole-tree e2e、所有单元测试与每文件 100% coverage。
- package validator、script-disabled pack、示例和教程的独立 packed install。
- 每份 conformance 报告必须满足 `declared === executed`、`skipped === []`、
  `failures === []`，且递归发现的 Harness 实例全部精确为 `0.1.2-alpha.2`。
- fallback、provider swap/unload、late-result、abort 和 20/40/80/120 width 证据。
- profile `blue-dsh-alpha` 的真实安装、pseudo-TTY smoke 与真人终端验收。

### Deletion Condition

- `use-sync-external-store` override：上游 Harness alpha 自身解析到 React 19
  compatible `>=1.6.0` 后删除，并重算两份 lockfile。
- `title-cadence.ts` bridge：alpha.2 的 session-title 仍从 `request/header` /
  `onMainRequest` 边界启动，无法独立实现每条 human message 刷新；上游提供等价
  cadence 且双消息真实验收通过后删除。
- 旧本地 `standard/code/minimal/cordis` preset：本迁移直接物理删除，不保留
  compatibility alias；需要自定义的用户应创建自己的唯一 id。
- RC conformance：不设恢复条件；未来若重新支持，必须作为新的显式兼容决策，
  补齐精确 peer、完整 packed fixture 和真实 profile 证据。

## 验证与交付

自动门禁按以下顺序执行并记录真实结果：

```sh
pnpm peers check
pnpm typecheck
pnpm lint
pnpm build
pnpm check:lib
pnpm test
pnpm test:coverage
pnpm check:pack
pnpm check:examples
pnpm diagrams:check
pnpm check:plugin-authoring-docs
pnpm fixture:plugin-tutorial
pnpm website:build
node script/blue-plugin-validate.mjs packages/bundle/blue
```

本迁移分支的自动证据：

- `pnpm test`：195 files，3141 passed，31 skipped；coverage 每文件四项均 100%。
- `pnpm check:lib`：90 claims；`pnpm check:pack`：12 tarballs；examples 8/8，
  递归发现的 48 个 Harness packages 全为 `0.1.2-alpha.2`。
- app、interaction、conversation、harness-adapter、transcript、OpenPencil、Lark 的
  package validator 全部为 `valid: true`，无 architecture/package/lifecycle violation。
- packed fixtures：app 8/8、interaction 11/11、conversation 11/11、
  harness-adapter 8/8、transcript 13/13、OpenPencil 9/9、Lark 9/9；全部使用正常
  peer resolution，`skipped`/`failures` 为空，Harness 闭包精确为 alpha.2。
- `smoke:happy`、`smoke:pty`、`smoke:pty:mouse`、`smoke:pty:output` 全部
  `exit=0`；shipped `standard` 实际挂载，40 列无 overflow，大输出后编辑器恢复。
- `blue-dsh-alpha` pseudo-TTY 正常启动并退出，bracketed paste 开/关各一次，
  无 fatal/crash/width/overflow；profile 的 `dsh.profile.patchReload` 保持 `live`。

随后用 `PROFILE=blue-dsh-alpha script/install-dev.sh` 创建并保留专用 profile，
检查其 `package.json` 中 `dsh.profile.patchReload` 在安装/更新后未被 Blue 抹掉，
并运行 pseudo-TTY smoke。最后由维护者执行：

```sh
dsh --profile blue-dsh-alpha
```

验收至少覆盖启动、`/version`、`/preset` 五项 roster、`blue-cordis` 激活、
`/settings` alpha channel、questionnaire、Todo、退出时 terminal restore 和窄宽度
显示。真人确认前 PR 保持 Draft。

当前人工终端验收状态：待维护者执行，未由自动化结果替代。
