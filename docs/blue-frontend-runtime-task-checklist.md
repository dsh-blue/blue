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
| F3 | 官方 projection、action、PanelModel/TUI consumer 和 upstream fixture 已完成 | 专用 profile 与人工验收 |
| F4 | 官方 connection adapter 和真实 Unix-socket daemon fixture 已完成 | SSH bootstrap/profile 仍是外部验收项 |
| F5 | 七类 surface 均有 model consumer；transcript 已有官方 producer/replacement consumer | 专用 profile 对比，验收后才切默认 row/删旧路径 |
| F6 | 四份 skill、validator、生态 adapter 和当前/上一线 packed fixture 已完成 | 专用 profile dogfood 与人工验收 |

## F3：dsh-context Vertical Slice

### F3-01 官方契约确认

- `[x]` 固定支持的 dsh-context 版本和 Harness line，记录官方 event/service/schema 来源。
- `[x]` 建立 `ContextSource` 到官方 projection/service 的窄 adapter；domain 包不依赖 Blue。
- `[x]` 明确 capability 探测：context、breakdown、refresh、status；缺失时返回 absent。
- `[x]` 为 adapter 写删除条件和版本差异说明。

验收证据：官方 API fixture、adapter contract 文档、capability matrix。

### F3-02 Projection replay/resume

- `[x]` 快照先建立 watermark，再订阅增量；只接受 watermark 之后的 seq。
- `[x]` usage sample 按 turn/step replace，不能重复累计同一 sample。
- `[x]` pressure 使用 projected tokens 优先级，breakdown 可选。
- `[x]` attach、detach、session switch、重复 seq、错误 session、late event 全部有测试。
- `[x]` resume 后的 projection 与首次 replay 得到同一 readonly state。

验收证据：`packages/context/tests` replay/resume、watermark、late-event specs。

### F3-03 Context action/command

- `[x]` `/context` command 由当前 session binding 生成。
- `[x]` refresh 是结构化 action，经 action coordinator 执行并返回 `BlueResult`。
- `[x]` action 支持 abort、session epoch 和 stale rejection。
- `[x]` 未连接 session、无 refresh capability、官方请求失败时显示明确 fallback。
- `[x]` `ContextFeature.execute()` 不保留占位 no-op；必须调用真实 domain/action。

验收证据：action unit tests、headless action fixture、错误码矩阵。

### F3-04 Interaction model 与 TUI consumer

- `[x]` `ContextModel` 只包含 readonly `PanelModel`/`StatusModel` 和结构化 action。
- `[x]` 在 core/renderer adapter 中增加官方 consumer，将 model 渲染为 panel/status。
- `[x]` renderer 不直接读取 `ContextEvent` 或 Harness Agent/Session 对象。
- `[x]` loading、absent、error、empty、breakdown-present 五种状态都有呈现。
- `[x]` 旧 `blue-status-context` 保留为 fallback，避免新 provider 失败时空白。

验收证据：renderer fixture、golden snapshot、plain fallback test。

### F3-05 Width、unload 与 real-process

- `[x]` 使用共享 width scan 覆盖 20/40/80/120 列、CJK、长路径、极端 token 数。
- `[x]` provider unload 清理 subscription、timer、cache 和 pending action。
- `[x]` unload 后 late result/event 不得重新挂载或刷新 UI。
- `[x]` 在独立 profile 中运行 `/context`，完成 snapshot、incremental、resume、窄终端 smoke。
- `[ ]` 人工验收：普通终端、tmux、resize、长流输出、切换 session。

验收证据：`pnpm test:coverage`、`smoke:happy`、真实 profile 记录和录屏/日志。

### F3-06 Bundle 切换门槛

- `[x]` 新增 production-disabled 的独立 `blue-context` acceptance row。
- `[x]` row 注明 capability、fallback 和禁用方式。
- `[ ]` 默认 bundle 切换前完成旧/新 renderer 对比和用户 live acceptance。
- `[ ]` 只有确认无旧 consumer 后，才删除 compatibility bridge。

## F4：Session Runtime 与 dsh-remote

### F4-01 真实 remote wire fixture

- `[x]` 固定 dsh-remote v1/v2 wire protocol、rc.6 ABI 和 fixture 运行时 git revision。
- `[x]` 使用真实 client/daemon 或可启动的 protocol fixture，不只使用手写 transport fake。
- `[x]` health negotiation、protocol mismatch、reopen、stop、transport failure 都有场景。
- `[x]` capability 列表区分 session、projection、action、question、approval、writeLease。

验收证据：独立 daemon fixture、wire trace、protocol compatibility report。

### F4-02 Attach/detach 与多 session

- `[x]` 支持至少两个 session 同时 projection，当前 session binding 只选择一个。
- `[x]` switch 顺序固定为 abort action -> stop subscription -> clear cache -> attach new snapshot -> publish binding。
- `[x]` snapshot watermark 与 mux event seq 去重正确。
- `[x]` 旧 session 的 late event、旧 request result、旧 question answer 均被丢弃。
- `[x]` reconnect/reopen 后从 watermark 续传，不能重复应用事件。

验收证据：`packages/remote/tests` 多 session、seq resume、late-result、reopen specs。

### F4-03 Action、question、approval

- `[x]` followup、steer、queue、interrupt 的 capability 行为明确；v1 interrupt 返回 structured absent，v2 映射官方 cancel。
- `[x]` ActionCoordinator 覆盖 abort、queue、request/session epoch、stale rejection。
- `[x]` question/approval RPC 绑定 session 和 request，旧 session answer 不得落入新 session。
- `[ ]` remote 错误、超时、取消、重复 response 均有结构化结果。

验收证据：action/question/approval contract fixture 和错误码测试。

### F4-04 Write lease

- `[x]` adapter 实现 lease acquire/release、`expiresAt` 传递和 disconnect attachment 清理；过期判定仍由外部 daemon 所有。
- `[x]` lease capability absent 时 headless caller 收到 structured absent，不阻塞 session runtime。
- `[x]` release 失败返回 structured diagnostic，disconnect 仍继续清理。
- `[ ]` 并发 acquire、旧 lease、过期 lease 和网络断开都有测试。

验收证据：lease state machine tests、disconnect cleanup test、wire trace。

### F4-05 真实 SSH/profile dogfood

- `[ ]` 准备独立 `blue-remote-<tag>` profile，生产 `blue` profile 不参与测试。
- `[ ]` 真实启动 remote daemon，完成 attach、切换、prompt、question/approval、断线重连。
- `[ ]` 检查 daemon 退出、CLI 退出、终端 resize、tmux/SSH 复制行为。
- `[ ]` 记录运行时延迟、错误、seq、lease 和退出码。

验收证据：dogfood log、PTY transcript、profile 配置、人工验收结论。

### F4-06 Bundle 与 domain 边界

- `[x]` remote domain/runtime 包不引入 pi-tui、ANSI、DOM、React 或 raw terminal。
- `[x]` remote 保持 headless、无默认 TUI row，缺 renderer 不会 pending。
- `[x]` 独立 packed composition、capability fallback 和卸载均有测试。

## F5：官方 Surface 迁移

### F5-00 迁移矩阵与删除清单

- `[x]` 为 status、dock、command、tool、theme、editor、transcript 各建立迁移表。
- `[x]` 每项记录旧 consumer、新 provider/model、官方 API、fallback、bundle row、删除条件和 owner。
- `[x]` 明确“旧 renderer 仍是 baseline”的范围，禁止重复挂载同一 surface。

### F5-01 Status

- `[x]` status model 接入正式 footer consumer。
- `[x]` 覆盖 model/cwd/git/title/context/mode 等现有 status 条目。
- `[x]` 缺 capability、空值、窄终端和主题切换有 fallback/golden。
- `[x]` 完成 unload/reload、优先级、band 和重复注册测试。

### F5-02 Dock

- `[x]` dock model 接入正式 bottom/left/right consumer。
- `[x]` 固定 dock 排序、优先级、preferredRows、collapsed 行为。
- `[x]` 验证编辑框固定底部、transcript 独立滚动、鼠标/键盘/PageUp/PageDown 不抢焦点。
- `[x]` 验证新消息通知、用户滚动后 tail-follow 暂停和 End 快捷键。

### F5-03 Command/Panel

- `[x]` command model 由统一 command consumer 执行，不在 renderer 内直接调用 Harness service。
- `[x]` PanelModel 覆盖 select/form/info/loading/error、submit/cancel、absent。
- `[x]` `/context`、`/sessions`、`/model`、`/help` 至少各有一条新 model consumer fixture。
- `[x]` 面板关闭、编辑器 slot replacement、焦点恢复和鼠标滚轮有测试。

### F5-04 Tool presentation

- `[x]` tool model 与 canonical tool call/result 分离，renderer 不自行折叠 session events。
- `[x]` Read/Write/Shell/失败/长输出/折叠/展开均有 structured presentation。
- `[x]` intent registry、plain fallback、Ctrl-O、width scan、golden/e2e 完成。
- `[x]` 未识别 tool intent 仍可显示通用文本结果。

### F5-05 Theme semantic model

- `[x]` 主题只注册 semantic tokens，renderer 负责编译为 terminal theme。
- `[x]` theme activation、重复注册、Fiber unload、失败回退有测试。
- `[x]` 新 model consumer 不暴露 ANSI 或 pi-tui 类型。
- `[x]` dark/light/auto/custom、CJK 和窄终端 golden 全部通过。

### F5-06 Editor

- `[x]` EditorModel 与 input action 接入正式 editor consumer。
- `[x]` editor slot replacement、焦点恢复、paste、history、completion、submit/abort 有测试。
- `[x]` AltScreen 下鼠标滚轮、拖选复制、键盘滚动和 PageUp/PageDown 不回归。
- `[x]` 编辑框始终底部，transcript viewport 独立滚动，用户滚动后不被新消息抢回。

### F5-07 Transcript

- `[x]` TranscriptModel 接入正式 viewport consumer，旧 transcript renderer 继续作为对照基线。
- `[x]` replay/live/resume/long stream/interrupted/tool/thinking/image/markdown 均有 model fixture。
- `[x]` viewport 只挂载可见窗口内容，长 session 不无限增加 component mount。
- `[x]` 滚动、tail-follow、new-message notification、End shortcut、resize、复制有 PTY/golden 场景。
- `[ ]` 新 consumer 与旧 baseline 逐项对比后，才允许默认 bundle 替换。

### F5-08 每个 surface 的统一切换门禁

- `[x]` official consumer 已存在。
- `[x]` headless fixture、unload/reload、late-result、width scan、golden/e2e 全通过。
- `[x]` plain fallback 和 capability absent 已验证。
- `[ ]` 独立 profile 人工验收通过。
- `[x]` 更新对应 package `AGENTS.md`、bundle row 和删除清单。

## F6：Skills 与生态验证

### F6-01 让 fixture runner 真正执行全部场景

- `[x]` `script/blue-plugin-fixture.mjs` 不只打印场景清单，而是实际执行 projection replay/resume、action abort/stale、swap/fallback、unload/late event、width scan。
- `[x]` 支持独立安装多个本地 tarball，正确解析 workspace peer 依赖。
- `[x]` fixture 不使用 `packages/*/src` 相对 import。
- `[x]` fixture 失败时输出 package、scenario、错误码和复现命令。

验收证据：`--install` 的实际 executed 列表覆盖全部场景，不能只显示 scenarios。

### F6-02 Plugin development/migration skill

- `[x]` skill 能输出 Domain/Interaction/Renderer/Composition 分类和 scope。
- `[x]` 能扫描 pi-tui/ANSI/DOM、Agent/Session 直访、event folding、module singleton、隐含 bundle 依赖。
- `[x]` 能生成 package split、adapter、capability、fallback、unload、测试清单。
- `[x]` 对 workspace package 和两个外部 adapter 运行，输出稳定诊断结果。

### F6-03 Plugin fixture/validation skill

- `[x]` 从 manifest 解析本地 closure 和 package-specific 场景，执行 headless/TUI/provider/unload/projection/action/width fixture 计划。
- `[x]` 自动检查 exports、files、lib、stable name/inject/apply、Fiber cleanup。
- `[x]` 检查 public API 不暴露 renderer-specific 类型。
- `[x]` 输出可机器解析的 JSON 报告并由 Vitest 进程测试固定非零失败退出。

### F6-04 dsh-openpencil adapter

- `[x]` 只消费官方 tool result 和 presentation callback 的最小事实；signed capability metadata 在边界剥离。
- `[x]` Web canvas/React/editor capability 缺失时提供文本/diff/plain fallback。
- `[x]` batch/file lifecycle 继续由 domain tools 所有；Blue 对 create/edit/new 等 canonical result、失败通知、capability absent 和卸载有 fixture。
- `[x]` 不复制 canvas、bearer capability 或 package-internal API。

### F6-05 dsh-lark adapter

- `[x]` 将外部 reconcile action 映射为官方 command 和 notification model。
- `[x]` operation id 去重、失败/成功/重试状态和 notification 生命周期有测试。
- `[x]` settings/credentials 只通过官方 loopback route 读取最小 redacted fact，Blue 不保存第二套状态。
- `[x]` 无 Web route/React client 时 domain 仍可运行，Blue adapter 提供 plain fallback。

### F6-06 独立安装与生态验收

- `[x]` 为 frontend、harness-adapter、context、conversation、transcript、remote、openpencil、lark 准备可独立安装 fixture。
- `[x]` 以完整本地 tarball closure 解决 workspace peer；临时项目显式安装所有外部 peer。
- `[x]` 当前 Harness `0.1.1-rc.2` 与上一 Harness `0.1.1-rc.1` 各运行一次 contract fixture。
- `[x]` 完成真实 profile dogfood，记录安装、启动、fallback、错误和退出码；provider 卸载由 packed/e2e fixture 记录。
- `[x]` 更新生态审计、README、package `AGENTS.md` 和删除条件。

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
node script/blue-plugin-fixture.mjs <package> --install --harness-line 0.1.1-rc.1
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
- `[x]` F6 skills 能生成/诊断真实插件，fixture runner 实际执行全部场景，openpencil/lark adapter 和独立安装通过。
- `[ ]` 当前/上一 Harness line、全量门禁、真实 profile 和用户 live acceptance 全部有记录。
- `[ ]` 合并后在主 checkout 重新 `pnpm run build`，并保留 dogfood log。
