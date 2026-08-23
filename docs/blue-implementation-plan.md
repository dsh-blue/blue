# Blue Frontend Runtime 实施计划

> 分支：p2/frontend-runtime。本文是目标架构文档之后的执行正典；每个阶段保持可启动、可测试、可从 master 同步。

## 目标与边界

在现有 master 行为基线上实现新的 frontend runtime。Harness 仍是 Agent/domain 能力的所有者；Blue 实现 renderer-neutral interaction model 和 TUI renderer。首期建立新路径并以旧路径作行为基线，不重写现有 transcript/editor。

必须保持：

- 只有 core 触碰 pi-tui、ANSI、raw terminal 和宽度真值；
- 新功能只消费 Harness 文档化/官方 API；
- 兼容 adapter 独立、窄化、可删除，不暴露 Agent/Session；
- Domain、Interaction、Renderer、Composition 分开；
- provider/registry/action 都有 Fiber 生命周期和 unload 语义；
- master 的必要 bugfix/Harness bump 可同步，但不直接搬入旧 UI 实现。

## 阶段与交付物

### F0：分支基线与契约冻结

交付 @dsh-blue/blue-frontend 包骨架、blue-harness-adapter 边界、capability absent/Fiber unload/provider swap/plain fallback fixture、domain 与 *-blue bundle 结构和 master 同步规则。

完成条件：现有 test/coverage/typecheck/lint/build/smoke 通过；新包不依赖 pi-tui、transcript、interaction 或 app；新服务不挂默认 bundle，现有 UI 不变。

### F1：最小 frontend runtime

实现 readonly Text/Fields/Sections/List/Code/Diff view、CommandModel、PanelModel（select/form/info）、StatusModel、DockModel、NotificationModel，以及 provider host。

统一 provider 生命周期：capture -> abort -> dispose -> activate -> restore。model 只包含 readonly 数据和结构化 action，不含 pi-tui、React、ANSI、terminal width、focus handle、Promise。激活失败回退 plain provider，不能影响 Agent loop。

验收：headless 可构造/快照 model；unload 清理 timer、订阅、注册和异步任务；TUI renderer 只消费 model。

### F2：Harness 兼容 adapter

按能力拆分 session、projection、action、model、question/approval bridge。以 capability probing 为主，版本判断集中在 adapter；每个 adapter 记录删除条件。上游有原生 projection/action 时优先直连。

验收：attach watermark 与增量订阅无竞态；action 支持 abort、queue、session/request epoch 和 stale rejection；unload 无晚到 UI 更新；缺能力时 feature absent/fallback，不 pending 整树。

### F3：dsh-context 垂直切片

链路为 dsh-context domain -> context projection -> context action/command -> panel/status interaction model -> Blue TUI renderer。

交付 domain/adapter 分离、replay/resume、/context model、panel/status、headless fixture、unload/width/snapshot/real-process 场景。旧 surface 继续作 baseline；新 provider 行为等价后才切 bundle row。

验收：数据和 watermark 与 Harness/Web 语义一致；CJK/窄终端通过 width contract；真实 Blue profile 完成 smoke 和用户 dogfood。

当前实现：`packages/context` 已通过窄 structural adapter 直读官方 `sessionProjections.snapshot/onChanged`，消费 dsh-context 的 `contextTimeline` 及 token-meter 的三个 projection key；同 seq 多 key 经 microtask 合并后读取一致 snapshot，baseline/subscription 缝隙有 buffer，domain/Fiber unload 会清除旧 timeline。`FrontendPanel` 是 `/context` 的 TUI consumer，旧 `InfoPanel` 保持 fallback。真实 upstream fixture `pnpm fixture:context-upstream -- --upstream <checkout>` 已对 `dsh-context@0.25.3` 验证四 key baseline、push、domain unload 和 Blue unload。bundle 中 `blue-context` 行仍 disabled，等待专用 profile 的用户 live acceptance。

### F4：session runtime 和 dsh-remote

实现 projection registry、action coordinator、current-session binding、dsh-remote session/proxy adapter，验证 attach/detach、seq resume、write lease、approval/question bridge。

当前实现位于 [`packages/remote`](../packages/remote)：`DshRemoteTransport` 已接入官方 `DshRemoteConnection` structural surface，以显式 authorization 调用 `session.list/history/prompt/cancel`，在 baseline 前开启 mux 并缓存 snapshot/subscribe 缝隙，detach 时释放 read/write attachment 和 event stream；question/approval 使用 `/api/respond` client-response carrier。`pnpm fixture:remote-upstream -- --upstream <checkout>` 已通过真实 Unix socket 验证 pairing/authentication/negotiate、双 session、write-lease 竞争/释放和 late-event cleanup。该 fixture 对应外部 rc.6 ABI，不代表 SSH bootstrap 或当前 Blue Harness line 已人工验收；SSH 仍由外部 registry/profile 负责。

验收：runtime 不限于单 session；switch 先 abort 再清理订阅/cache；remote late event 不回挂旧 UI；domain bundle 不依赖 TUI。

### F5：官方 surface 迁移

按 status、dock、command、tool presentation、theme、editor、transcript 顺序迁移。每项必须有新 provider/registry、官方 consumer、replacement fixture、unload/reload、width-scan、golden/e2e、bundle row 和 plain fallback。旧实现只在对应验收后删除。

当前进度：status、dock、command、tool presentation、theme semantic model、editor model 和 transcript registry 均已 additive 接入；旧 transcript/editor renderer 仍保留为 golden baseline，transcript model 默认不重复挂载旧行。

### F6：skills 和生态验证

实现 plugin-development、plugin-migration、plugin-fixture、plugin-validation；完成 dsh-openpencil capability/fallback 和 dsh-lark action/notification 审计；验证独立安装包 fixture。

当前进度：四份 skill 文档、静态 validator、独立 fixture manifest 入口和两个上游浅克隆审计已完成；真实外部 Blue adapter 迁移与人工 profile 验收仍是后续工作。

## Master 同步和合并

本分支每周或每次 Harness line bump 同步 master。必要 bugfix 直接同步；master 新增旧架构 UI 不直接 cherry-pick，按新 runtime 重做。Harness 新能力以 adapter + feature + bundle row + fixture additive 接入。每阶段保持独立提交并打内部 tag。最终合并前通过当前/上一 Harness line fixture、全量 gate、真实 profile smoke 和用户 live acceptance；合并后在主 checkout 重新 build。

## 完成定义

1. frontend runtime、adapter、TUI renderer 可独立启动；
2. dsh-context 和 dsh-remote fixture 通过；
3. 官方能力迁移且无行为回归；
4. provider 可卸载、替换、失败回退；
5. 新功能不修改 TUI kernel 或暴露 pi-tui；
6. master 新 Harness 能力可 additive 接入；
7. skills 能生成和迁移真实插件；
8. 旧 compatibility seam 有删除清单并在无消费者后移除。
