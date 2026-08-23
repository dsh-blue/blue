# F3/F4/F5/F6 开发任务清单

> 用途：按 `docs/blue-implementation-plan.md` 推进 frontend-runtime 后续开发。
> 规则：每个任务先完成自动化测试，再进行真实 profile/终端人工验收；人工验收通过前，不切换默认 bundle row，也不删除旧实现。

## 使用规则

- `[ ]` 表示未完成，`[x]` 只表示有可核对证据，不接受“代码看起来完成”作为完成依据。
- 每个 vertical slice 必须同时具备：Domain/adapter、projection/action、interaction model、renderer consumer、headless fixture、unload/late-result、width scan、golden/e2e、bundle/fallback 方案。
- 所有新 runtime 包保持 renderer-neutral；只有 `packages/core` 可以依赖 pi-tui、ANSI、raw terminal 和终端宽度真值。
- 外部能力缺失是正常路径，必须返回 capability absent 或 plain fallback，不得让整棵 Cordis tree pending。
- 每次 Harness line 升级都要跑当前线和上一线 contract fixture；没有 fixture 不能宣称兼容完成。

## 当前状态总览

| 阶段 | 当前状态 | 下一步重点 |
|---|---|---|
| F3 | headless generic slice 已有，未接官方 dsh-context/TUI consumer | 完成官方 vertical slice 和真实 profile 验收 |
| F4 | registry、binding、wire adapter 已有 | 接真实 dsh-remote daemon，补 write lease/网络生命周期验收 |
| F5 | model/registry additive surface 已有，旧 renderer 仍是 baseline | 按 surface 逐项接入官方 consumer，逐项切 row |
| F6 | skill 文档、validator、浅审计已有 | 让 fixture 真正执行全部场景，完成 openpencil/lark adapter |

## F3：dsh-context Vertical Slice

### F3-01 官方契约确认

- `[ ]` 固定支持的 dsh-context 版本和 Harness line，记录官方 event/service/schema 来源。
- `[ ]` 建立 `ContextSource` 到官方 projection/service 的窄 adapter；domain 包不依赖 Blue。
- `[ ]` 明确 capability 探测：context、breakdown、refresh、status；缺失时返回 absent。
- `[ ]` 为 adapter 写删除条件和版本差异说明。

验收证据：官方 API fixture、adapter contract 文档、capability matrix。

### F3-02 Projection replay/resume

- `[ ]` 快照先建立 watermark，再订阅增量；只接受 watermark 之后的 seq。
- `[ ]` usage sample 按 turn/step replace，不能重复累计同一 sample。
- `[ ]` pressure 使用 projected tokens 优先级，breakdown 可选。
- `[ ]` attach、detach、session switch、重复 seq、错误 session、late event 全部有测试。
- `[ ]` resume 后的 projection 与首次 replay 得到同一 readonly state。

验收证据：`packages/context/tests` replay/resume、watermark、late-event specs。

### F3-03 Context action/command

- `[ ]` `/context` command 由当前 session binding 生成。
- `[ ]` refresh 是结构化 action，经 action coordinator 执行并返回 `BlueResult`。
- `[ ]` action 支持 abort、session epoch 和 stale rejection。
- `[ ]` 未连接 session、无 refresh capability、官方请求失败时显示明确 fallback。
- `[ ]` `ContextFeature.execute()` 不保留占位 no-op；必须调用真实 domain/action。

验收证据：action unit tests、headless action fixture、错误码矩阵。

### F3-04 Interaction model 与 TUI consumer

- `[ ]` `ContextModel` 只包含 readonly `PanelModel`/`StatusModel` 和结构化 action。
- `[ ]` 在 core/renderer adapter 中增加官方 consumer，将 model 渲染为 panel/status。
- `[ ]` renderer 不直接读取 `ContextEvent` 或 Harness Agent/Session 对象。
- `[ ]` loading、absent、error、empty、breakdown-present 五种状态都有呈现。
- `[ ]` 旧 `blue-status-context` 保留为 fallback，避免新 provider 失败时空白。

验收证据：renderer fixture、golden snapshot、plain fallback test。

### F3-05 Width、unload 与 real-process

- `[ ]` 使用共享 width scan 覆盖 20/40/80/120 列、CJK、长路径、极端 token 数。
- `[ ]` provider unload 清理 subscription、timer、cache 和 pending action。
- `[ ]` unload 后 late result/event 不得重新挂载或刷新 UI。
- `[ ]` 在独立 profile 中运行 `/context`，完成 snapshot、incremental、resume、窄终端 smoke。
- `[ ]` 人工验收：普通终端、tmux、resize、长流输出、切换 session。

验收证据：`pnpm test:coverage`、`smoke:happy`、真实 profile 记录和录屏/日志。

### F3-06 Bundle 切换门槛

- `[ ]` F3 所有前置验收通过后，新增独立 `blue-context`/`blue-context-blue` row。
- `[ ]` row 注明 inject、capability、fallback 和禁用方式。
- `[ ]` 默认 bundle 切换前完成旧/新 renderer 对比和用户 live acceptance。
- `[ ]` 只有确认无旧 consumer 后，才删除 compatibility bridge。

## F4：Session Runtime 与 dsh-remote

### F4-01 真实 remote wire fixture

- `[ ]` 固定 dsh-remote v1 wire protocol 和官方 npm/git revision。
- `[ ]` 使用真实 client/daemon 或可启动的 protocol fixture，不只使用手写 transport fake。
- `[ ]` health negotiation、protocol mismatch、reopen、stop、transport failure 都有场景。
- `[ ]` capability 列表区分 session、projection、action、question、approval、writeLease。

验收证据：独立 daemon fixture、wire trace、protocol compatibility report。

### F4-02 Attach/detach 与多 session

- `[ ]` 支持至少两个 session 同时 projection，当前 session binding 只选择一个。
- `[ ]` switch 顺序固定为 abort action -> stop subscription -> clear cache -> attach new snapshot -> publish binding。
- `[ ]` snapshot watermark 与 mux event seq 去重正确。
- `[ ]` 旧 session 的 late event、旧 request result、旧 question answer 均被丢弃。
- `[ ]` reconnect/reopen 后从 watermark 续传，不能重复应用事件。

验收证据：`packages/remote/tests` 多 session、seq resume、late-result、reopen specs。

### F4-03 Action、question、approval

- `[ ]` followup、steer、queue、interrupt 的 capability 行为明确；不支持 interrupt 时返回 absent，而非抛未分类异常。
- `[ ]` ActionCoordinator 覆盖 abort、queue、request/session epoch、stale rejection。
- `[ ]` question/approval RPC 绑定 session 和 request，旧 session answer 不得落入新 session。
- `[ ]` remote 错误、超时、取消、重复 response 均有结构化结果。

验收证据：action/question/approval contract fixture 和错误码测试。

### F4-04 Write lease

- `[ ]` 实现 lease acquire/release、过期和 disconnect 清理。
- `[ ]` lease capability absent 时 UI 显示只读状态，不阻塞 session runtime。
- `[ ]` release 失败必须记录诊断但不能卡住 disconnect。
- `[ ]` 并发 acquire、旧 lease、过期 lease 和网络断开都有测试。

验收证据：lease state machine tests、disconnect cleanup test、wire trace。

### F4-05 真实 SSH/profile dogfood

- `[ ]` 准备独立 `blue-remote-<tag>` profile，生产 `blue` profile 不参与测试。
- `[ ]` 真实启动 remote daemon，完成 attach、切换、prompt、question/approval、断线重连。
- `[ ]` 检查 daemon 退出、CLI 退出、终端 resize、tmux/SSH 复制行为。
- `[ ]` 记录运行时延迟、错误、seq、lease 和退出码。

验收证据：dogfood log、PTY transcript、profile 配置、人工验收结论。

### F4-06 Bundle 与 domain 边界

- `[ ]` remote domain/runtime 包不引入 pi-tui、ANSI、DOM、React 或 raw terminal。
- `[ ]` TUI adapter 作为独立可选 row，headless profile 不因缺少 renderer pending。
- `[ ]` bundle composition、禁用、fallback、卸载均有测试。

## F5：官方 Surface 迁移

### F5-00 迁移矩阵与删除清单

- `[ ]` 为 status、dock、command、tool、theme、editor、transcript 各建立迁移表。
- `[ ]` 每项记录旧 consumer、新 provider/model、官方 API、fallback、bundle row、删除条件和 owner。
- `[ ]` 明确“旧 renderer 仍是 baseline”的范围，禁止重复挂载同一 surface。

### F5-01 Status

- `[ ]` status model 接入正式 footer consumer。
- `[ ]` 覆盖 model/cwd/git/title/context/mode 等现有 status 条目。
- `[ ]` 缺 capability、空值、窄终端和主题切换有 fallback/golden。
- `[ ]` 完成 unload/reload、优先级、band 和重复注册测试。

### F5-02 Dock

- `[ ]` dock model 接入正式 bottom/left/right consumer。
- `[ ]` 固定 dock 排序、优先级、preferredRows、collapsed 行为。
- `[ ]` 验证编辑框固定底部、transcript 独立滚动、鼠标/键盘/PageUp/PageDown 不抢焦点。
- `[ ]` 验证新消息通知、用户滚动后 tail-follow 暂停和 End 快捷键。

### F5-03 Command/Panel

- `[ ]` command model 由统一 command consumer 执行，不在 renderer 内直接调用 Harness service。
- `[ ]` PanelModel 覆盖 select/form/info/loading/error、submit/cancel、absent。
- `[ ]` `/context`、`/sessions`、`/model`、`/help` 至少各有一条新 model consumer fixture。
- `[ ]` 面板关闭、编辑器 slot replacement、焦点恢复和鼠标滚轮有测试。

### F5-04 Tool presentation

- `[ ]` tool model 与 canonical tool call/result 分离，renderer 不自行折叠 session events。
- `[ ]` Read/Write/Shell/失败/长输出/折叠/展开均有 structured presentation。
- `[ ]` intent registry、plain fallback、Ctrl-O、width scan、golden/e2e 完成。
- `[ ]` 未识别 tool intent 仍可显示通用文本结果。

### F5-05 Theme semantic model

- `[ ]` 主题只注册 semantic tokens，renderer 负责编译为 terminal theme。
- `[ ]` theme activation、重复注册、Fiber unload、失败回退有测试。
- `[ ]` 新 model consumer 不暴露 ANSI 或 pi-tui 类型。
- `[ ]` dark/light/auto/custom、CJK 和窄终端 golden 全部通过。

### F5-06 Editor

- `[ ]` EditorModel 与 input action 接入正式 editor consumer。
- `[ ]` editor slot replacement、焦点恢复、paste、history、completion、submit/abort 有测试。
- `[ ]` AltScreen 下鼠标滚轮、拖选复制、键盘滚动和 PageUp/PageDown 不回归。
- `[ ]` 编辑框始终底部，transcript viewport 独立滚动，用户滚动后不被新消息抢回。

### F5-07 Transcript

- `[ ]` TranscriptModel 接入正式 viewport consumer，旧 transcript renderer 继续作为对照基线。
- `[ ]` replay/live/resume/long stream/interrupted/tool/thinking/image/markdown 均有 model fixture。
- `[ ]` viewport 只挂载可见窗口内容，长 session 不无限增加 component mount。
- `[ ]` 滚动、tail-follow、new-message notification、End shortcut、resize、复制有 PTY/golden 场景。
- `[ ]` 新 consumer 与旧 baseline 逐项对比后，才允许默认 bundle 替换。

### F5-08 每个 surface 的统一切换门禁

- `[ ]` official consumer 已存在。
- `[ ]` headless fixture、unload/reload、late-result、width scan、golden/e2e 全通过。
- `[ ]` plain fallback 和 capability absent 已验证。
- `[ ]` 独立 profile 人工验收通过。
- `[ ]` 更新对应 package `AGENTS.md`、bundle row 和删除清单。

## F6：Skills 与生态验证

### F6-01 让 fixture runner 真正执行全部场景

- `[ ]` `script/blue-plugin-fixture.mjs` 不只打印场景清单，而是实际执行 projection replay/resume、action abort/stale、swap/fallback、unload/late event、width scan。
- `[ ]` 支持独立安装多个本地 tarball，正确解析 workspace peer 依赖。
- `[ ]` fixture 不使用 `packages/*/src` 相对 import。
- `[ ]` fixture 失败时输出 package、scenario、错误码和复现命令。

验收证据：`--install` 的实际 executed 列表覆盖全部场景，不能只显示 scenarios。

### F6-02 Plugin development/migration skill

- `[ ]` skill 能输出 Domain/Interaction/Renderer/Composition 分类和 scope。
- `[ ]` 能扫描 pi-tui/ANSI/DOM、Agent/Session 直访、event folding、module singleton、隐含 bundle 依赖。
- `[ ]` 能生成 package split、adapter、capability、fallback、unload、测试清单。
- `[ ]` 对一个内部旧插件和一个外部插件运行，输出稳定诊断结果。

### F6-03 Plugin fixture/validation skill

- `[ ]` 从 manifest 生成 headless/TUI/provider/unload/projection/action/width fixture 骨架。
- `[ ]` 自动检查 exports、files、lib、stable name/inject/apply、Fiber cleanup。
- `[ ]` 检查 public API 不暴露 renderer-specific 类型。
- `[ ]` 输出可机器解析的 JSON 报告并在 CI 中失败。

### F6-04 dsh-openpencil adapter

- `[ ]` 只消费 domain tool summary、presentation metadata 和 signed capability 的最小事实。
- `[ ]` Web canvas/React/editor capability 缺失时提供文本/diff/plain fallback。
- `[ ]` batch action、文件生命周期、失败通知、capability absent、卸载有 fixture。
- `[ ]` 不复制 canvas、bearer capability 或 package-internal API。

### F6-05 dsh-lark adapter

- `[ ]` 将外部 action 映射为 command/notification model。
- `[ ]` operation id 去重、失败/成功/重试状态和 notification 生命周期有测试。
- `[ ]` credentials/config 只通过官方 service，Blue 不保存第二套状态。
- `[ ]` 无 Web route/React client 时 domain 仍可运行，Blue adapter 提供 plain fallback。

### F6-06 独立安装与生态验收

- `[ ]` 为 frontend、harness-adapter、context、remote、openpencil-blue、lark-blue 准备可独立安装 fixture。
- `[ ]` 解决 workspace peer 在临时目录中的安装问题：本地 tarball closure、临时 registry 或已发布版本三选一并记录方案。
- `[ ]` 当前 Harness line 与上一 Harness line 各运行一次 contract fixture。
- `[ ]` 完成真实 profile dogfood，记录安装、启动、卸载、fallback、错误和退出码。
- `[ ]` 更新生态审计、README、package `AGENTS.md` 和删除条件。

## 统一自动化门禁

每个阶段完成前必须运行：

```sh
pnpm run typecheck
pnpm run lint
pnpm run diagrams:check
pnpm run build
pnpm run check:lib
pnpm run test:coverage
pnpm run smoke:happy
pnpm run smoke:pty
pnpm run smoke:pty:mouse
```

涉及 website 或文档时追加：

```sh
pnpm run website:build
```

独立插件验收还必须运行：

```sh
node script/blue-plugin-validate.mjs <package>
node script/blue-plugin-fixture.mjs <package> --install
```

## 推荐执行顺序

1. F3-01、F3-02、F3-03，先把官方 context projection/action 契约固定。
2. F3-04、F3-05，完成第一个真实 TUI vertical slice；人工验收通过后做 F3-06。
3. F4-01、F4-02、F4-03；随后补 F4-04 的 lease 状态机。
4. F4-05 真实 daemon/profile dogfood，F4-06 做 bundle/domain 边界收口。
5. F6-01、F6-03 可以与 F3/F4 并行，但必须先解决独立安装 peer closure。
6. F5-00 建迁移矩阵，然后按 Status -> Dock -> Command/Panel -> Tool -> Theme -> Editor -> Transcript 逐项迁移。
7. F6-04、F6-05 在 fixture runner 稳定后进行，最后完成 F6-06 双 Harness line 和生态验收。

## 最终完成定义

- `[ ]` F3 context 官方 vertical slice 通过 headless、width、real-process 和人工 profile 验收。
- `[ ]` F4 remote 真实 daemon、multi-session、seq resume、question/approval、lease 和断线恢复通过。
- `[ ]` F5 每个官方 surface 都有 consumer、fixture、fallback、bundle row 和删除清单，旧实现无未登记 consumer。
- `[ ]` F6 skills 能生成/诊断真实插件，fixture runner 实际执行全部场景，openpencil/lark adapter 和独立安装通过。
- `[ ]` 当前/上一 Harness line、全量门禁、真实 profile 和用户 live acceptance 全部有记录。
- `[ ]` 合并后在主 checkout 重新 `pnpm run build`，并保留 dogfood log。
