# PR #77 插件协议收敛矩阵

> 状态：**Active merge control**
> 基线：`master@1d0f01e`
> 审计对象：PR [#77](https://github.com/dsh-blue/blue/pull/77) `p2/ui-api-refactor@c9e1600`
> merge-base：`1d0f01e`，PR 分支领先 48 commits
> 目标规范：[Blue 插件协议 v1 目标态契约](./blue-plugin-contract-v1.md)

2026-08-29 审计时，#77 的 CI 与 website check 为 green，但 GitHub 状态仍是 `BLOCKED / REVIEW_REQUIRED`；自动检查不替代本矩阵要求的 profile live acceptance。

本文只回答“PR #77 的现有实现如何进入 master，并继续收敛到插件协议 v1”。它不是长期 API 真相。#77 合并并完成 v1 收敛后，本文移入 `docs/history/`。

## 1. 总体判断

PR #77 已形成六条可保留的实现基座：

1. canonical `BlueUiNode`、builders、admission validator 和唯一 pi-tui compiler，legacy frontend renderer 已删除；
2. managed panes/overlays 与 focus、gesture、abort、buffer/replay；
3. additive status 和用户选择的 `status.provider`；
4. revision-fenced editor extension owner、completion/submit/action runtime；
5. 用户选择的 `editor.provider` shell swap、LKG/breaker/default fallback；
6. app-owned `session.read/session.act` 分离 facade、legacy dock 删除，以及仓内 public ecosystem packed suite。

它尚未形成可直接冻结的 `1.0.0` 插件协议。当前三层状态并不一致：

| 层 | 数量 | 当前事实 |
| --- | ---: | --- |
| manifest vocabulary | 10 | 包含 `session.read/session.act`、`editor.extensions/editor.provider` |
| public host implemented set | 10 | 十项均有 facade/registry；legacy `dock` runtime 已物理删除 |
| 默认 bundle advertised owner | 10 | host buffer、core/transcript/interaction/app owner rows 使十项均可协商 |

三个数字一致只说明 #77 已把接口接通，不说明接口适合冻结。`session.act` 仍越过目标 v1 的 domain authority 边界；`notifications` 允许普通 consumer 订阅全局通知；editor surfaces 尚未隔离为 Experimental；owner helper 仍可经 `symbols.original` 解包取得；manifest、validator、website 与 public root 继续存在身份、权限和稳定性矛盾。

因此采用两级门禁：

- **BETA-MERGE**：阻止 #77 以已知不安全或误称 Stable 的状态进入 master。
- **V1-RELEASE**：允许 Beta 基础先合并，但在 `BLUE_API_VERSION 1.0.0` 发布前必须完成。

裁决含义：

- `KEEP`：实现方向和公共语义可保留；仍需按目标契约补证据。
- `CHANGE`：保留纵向实现，但修改权限、shape、稳定性或 owner 边界。
- `REMOVE`：不得进入目标 v1 public surface；兼容代码按依赖顺序删除。
- `ADD`：PR #77 没有该目标能力或机器契约，需要后续实现。

## 2. 收敛矩阵

| Surface | #77 当前状态 | 裁决 | v1 目标 | Owner | Gate / 必需证据 |
| --- | --- | --- | --- | --- | --- |
| `BlueUiNode` wire | `packages/api/src/contracts.ts` 中闭合 union；纯 clone/freeze；callback 与 signal 仍为 process-local | KEEP | renderer-neutral canonical tree；文档明确“数据可检查”不等于整个 contribution 可跨进程序列化 | api owns wire | V1：hostile realm/getter/cycle/depth/node/collection corpus；外部 tarball consumer |
| `@dsh-blue/blue-ui` builders | 纯 builder、caller-safe，官方 panel/dialog/status 已消费 | KEEP | 只做 ergonomics，不另立 wire truth；输出必须通过同一 validator | ui package | V1：builder/wire/API declaration diff；至少两个外部插件共用 |
| core validator/compiler | core 是唯一 admission/compiler 和 pi-tui boundary；已有 exhaustive/width tests；`082c801` 已删除 legacy frontend renderer | KEEP | 非 core 包不接触 pi-tui、ANSI、terminal width/focus；compiler failure 隔离 contribution | core | V1：2..120 width/hostile node；public kit packed import；禁止恢复第二 renderer path |
| `panes` | host registry、每插件配额、buffer/replay、surface bridge、semantic events、responsive layout已实现；仓内 packed examples 覆盖 header/right/bottom、20/40/80/120、absent/admission/unload | KEEP | Stable managed surface；明确 renderer owner 暂未 attach 时的 retained queue/replay | core surface owner | V1：在真实 surface manager 补 narrow、owner reload、focus restore、late event；独立生态 packed consumer |
| `overlays` | one-shot gesture、capturing 配额、FIFO/latest-wins、abort/close/focus restore 已实现；仓内 packed example 覆盖 atomic capability rejection、gesture、unload/late use | KEEP | Stable managed overlay；普通插件不能主动开 capturing overlay | core overlay owner | V1：真实 renderer 的 focus/timeout/double submit/owner swap、hostile sibling；独立生态 packed consumer |
| additive `status` | narrow recursive status node、独立 revision、transcript owner/compiler 已实现 | KEEP | Stable additive status；非交互、不能夺取 footer composition | transcript status owner | V1：external status packed fixture、width、render throw、unload/reload |
| `status.provider` | inert candidates、settings selection、dry render、same-session LKG、cross-session default、3/60s breaker、fallback 已实现；仓内 packed candidate 的 13/13 双线证据来自 `b5f3310` checkpoint，只验证 admission/width/unload | CHANGE | 保留 provider 事务；专用 snapshot 不隐式带 session id/cwd/model；需要时显式申请 `session.read` resource；加入 session epoch/revision | transcript composition + settings | V1：final-head packed rerun、owner absent、theme/session switch、stale generation、selection persistence、failure attribution、真实 profile swap；dsh-status-bar 外部 slice |
| `commands` | interaction bridge 映射到 Harness commands，具备 AbortSignal、owner-minted gesture、duplicate rollback、unload | KEEP | 只承诺 Blue-local UI command；能直接注册 Harness command 的 domain 插件继续走 host service | interaction owner | V1：packed command、late settlement/unload、gesture chain；文档避免双 command discovery |
| `notifications` | 一个 capability 同时返回 publish/subscribe；任一普通 consumer 可收到其他插件 publish 的全局通知，owner bridge 另有 observer | CHANGE | public 只保留 `notifications.publish`；observe 属 owner control plane；定义 dedupe/replace/duration/priority 和动态 rate limit | notification model + interaction renderer | **BETA-MERGE blocker**：无条件移除普通 consumer subscribe并将 owner observe收回受 authority 保护的 control plane，不能靠降为 Experimental 保留越权观察。V1：publisher 隔离、sink absent、rate/dedupe、unload/late publish |
| `editor.extensions` | `5a24f54` 后已有真实 owner：passive node/action、`/ @ #` completion、submit transform、revision/abort/unload；9/9 双线 packed 证据来自 `03cb7e0` checkpoint；当前不提供 draft read/write | KEEP + CHANGE | Beta 保留纵向实现；v1 将现有 decorations/completions/submit.transform 拆权，并另增 draft.read/write，均为 Experimental/optional | interaction editor owner | BETA-MERGE：不得称 Stable且须 final-head packed rerun；`before/after` 静态 `BlueUiNode` 与 runtime passive subset 收窄一致。V1：逐项最小授权；真实 editor input/completion apply/submit profile 路径；draft/history/IME 不丢 |
| `editor.provider` | `fe48004` 后已有真实 owner、persisted user selection、actual-width dry render、同一 editor/focus 上的原子 shell swap、LKG/breaker/default fallback、abort/stale/unload；仓内 packed candidate 存在；public type仍只有 `render/onEvent`，未冻结 activate/dispose 或无状态 shell lifecycle语义 | KEEP + CHANGE | 作为 Experimental optional 的 host-owned editor shell provider；恰好一个 `editor-control`，不授予 draft/cursor/history/IME/raw-key 或 engine ownership；mode 另走 `session.read` grant | interaction owner + core compiler | BETA-MERGE：flat manifest阶段退出 public Stable surface、保留 internal/reference runtime。Experimental 发布：optional schema/subpath、public lifecycle、final-head packed和统一 profile。未来 Stable：独立生态 provider等完整门禁 |
| flat `capabilities[]` | required/optional、capability version、resource grant、form 均不可表达；`open()` all-or-nothing | CHANGE | 对象式 required/optional request；每项 `{name, version, resources?}`；返回 negotiated grants | api/schema + host | V1：positive/negative schema corpus；required fail、optional degrade、resource subset/denial、duplicate cross-group |
| manifest identity | 已有 `package.json.blue.manifest` pointer、root JSON、quickstart 和六个 packed examples；但 validator 仍硬找 root JSON，`entry` 写内部 `./lib/index.js`，源码在 `open()` 旁再手写 manifest，并要求 entry `name`=package | CHANGE | `package.json.blue.manifest` 唯一发现入口；id=package name；entry=exports subpath；Cordis name/row id 独立 | schema + installer | V1：packed package、exports/files、runtime import 同一 JSON、identity negative corpus |
| `integrity` author field | manifest 接受作者提供的 tarball digest | REMOVE | integrity/source commit 放 installer receipt/lock，不能由被验证包自证 | installer | V1：安装 receipt 和 source pin fixture；schema 拒绝 author integrity |
| semver admission | manifest 用字符正则；host 只用 `/^\^?1/` 近似 API major | CHANGE | 真实 semver range parse/intersection；API、product、Harness、Node、capability version 分离 | schema/runtime admission | V1：prerelease、union、upper bound、invalid range corpus |
| `session.read` | `f375c13` 已拆出纯 readonly `current/subscribe` facade、真实 app owner、monotonic revision、clone/freeze、replay/owner-gap fencing；但完整 `blueSessionReader` 仍是任意 sibling可 inject 的 Cordis service，可绕过 fields grant | CHANGE | 保留 readonly seed，按 identity/cwd/status/mode/model resource 裁剪，并加入明确 `sessionEpoch`；raw source只对 authority owner可见 | app + narrow harness adapter | **BETA-MERGE blocker**：隐藏/authority-gate raw reader并加 hostile direct-inject fixture。V1：same-id new epoch、session switch、headless absence、bounded snapshot、resource denial、no Agent/Session/write leakage |
| `session.act` | `f375c13` 已实现独立 requester、followup/steer/interrupt、host-wide FIFO、abort、session/owner/consumer/unload stale fencing和双 Harness 线 packed fixture；完整 `blueSessionRequester` 仍可被任意 sibling inject，same-id 仍只按 id 判断且无 gesture/resource policy | REMOVE | v1 无通用 session write；app内部 dispatcher不作为 plugin-facing service，业务写按真实 action 或 `conversation.itemActions` 扩展点设计 | domain plugin owns action | **BETA-MERGE blocker**：移出公开 vocabulary并隐藏/authority-gate raw requester，hostile sibling direct inject必须失败。V1：negative schema/API fixture |
| owner helper root exports | api root 仍导出 attach/snapshot/subscribe/mint/close；guarded proxy 直接调用现已拒绝，但官方 bridge 继续用 Cordis `symbols.original` 解包，普通 sibling 可复制该路径 | CHANGE | public host 只有 version/open/data facets；control plane 要求 bundle composition 创建的 authority/lease，普通 sibling 无法获得 | bundle + api host | **BETA-MERGE blocker**：hostile sibling 证明 unwrap/self-attach/snapshot/mint/close 均失败；官方 owner reload 保持正常 |
| aggregate owner snapshot | 一个 snapshot 同时含全部 capability contribution 与 revisions | CHANGE | owner subscription 按 capability/lease 窄化；owner 不能观察无关插件数据 | capability owners | BETA-MERGE：至少隔离公共 root。V1：per-owner subscription 和 cross-capability negative fixture |
| `BluePluginDefinition.apply(api: unknown)` | public type 无 loader/runtime consumer | REMOVE | v1 使用真实 Cordis entry + parsed manifest + negotiated typed API；不保留占位符 | api/loader | BETA-MERGE 或首个 schema PR 删除；compile negative fixture |
| error taxonomy | stale/timeout/unavailable/resource denial 不可区分，多处压入 `BLUE_ACTION_REJECTED/ABORTED` | CHANGE | 采用目标契约的 negotiation/admission/execution 错误分类；无异常跨边界 | api | V1：每个 code 有可复现 fixture，message 不承担机器语义 |
| legacy `dock` | `bbbe6b1` 已物理删除 type、registry、host aggregate、transcript bridge和 bundle consumer；validator 只保留 actionable migration diagnostic | REMOVE (CLOSED) | 保持 runtime 无 dock；旧 manifest 只返回明确迁移诊断 | transcript/core panes | Beta 代码门已关闭。V1：schema negative corpus 与 `rg` drift guard 防止兼容路径回流 |
| legacy `panels/editor/tools` | migration validator 仍识别这些旧名字；无 v1 owner/API | REMOVE | 不进入新 schema、catalog 或 API root；validator 只返回明确迁移诊断 | schema/validator | V1：negative corpus；网站不再把旧名字描述为 future capability |
| `projections.read` | `blueSessionProjections` app reader可按任意字符串返回 `unknown`，且仍是任意 sibling可 inject 的 Cordis service，没有 public resource gate | ADD | raw source只对 authority owner可见；manifest 精确 key allowlist；一致 cut、size bound、epoch/asOfSeq、key unload 语义 | app/harness adapter | **BETA-MERGE blocker**：隐藏/authority-gate raw projection reader并加 hostile direct-inject fixture。V1：dsh-context + Cost Meter，replay/resume、duplicate/older seq、key unload、late callback |
| conversation APIs | conversation projection存在，但无 public bounded reader、navigate 或 item action registry | ADD | `conversation.read/navigate/itemActions`；item action 只调度，业务执行留在插件 service | conversation + transcript/interaction | V1：Navigator、Rewind、Message Edit、Bookmark/Tag reference；pagination/stale/gesture/unload |
| `theme.provider` | frontend theme model存在；公开插件没有 provider negotiation/selection contract | ADD | semantic token candidate、用户选择、validation、fallback；无 ANSI/CSS | frontend/core composition | V1：Catppuccin，token completeness、swap failure、unload、narrow/width |
| `settings.sections` | Blue 有内部 settings panel 和 dsh-settings owner；无第三方 section contract | ADD | 只贡献 settings UI；plugin config/schema/persistence 直接 inject `dsh-settings` | interaction settings UI | V1：Catppuccin + Lark，read-only backend、conflict、unload；证明无 Blue storage |
| JSON Schema / TS manifest | 没有独立 schema；script 只检查字段存在且不复用 runtime validator | ADD | Draft 2020-12 schema 为源，生成 TS type；Ajv/validator/installer/runtime 共用；drift gate | api/schema | V1：schema corpus、generated diff、published URL/subpath、真实 tarball |
| public API plane | owner helpers、Stable/Experimental、plugin-facing types混在 root | CHANGE | root 只导出 Stable；Experimental 走明确 subpath/标记；owner authority 不可由普通插件取得 | api package | BETA-MERGE：稳定性声明收窄。V1：API declaration report、exports/files/tsdown triangle |
| docs/skills | website/README/skills 已补实际 session/editor owner 和示例，但把 flat manifest、`session.act`、editor surfaces 与 owner helpers一并描述成 Stable 1.0 | CHANGE | contract 是目标真相；package AGENTS 是当前实现；能力表从 schema/catalog 校验生成；中英同步 | docs + package owners | **BETA-MERGE blocker**：按 Stable/Experimental/Rejected 重写，不把“已实现”当“已冻结”。V1：docs build、parity、examples packed install、skill eval |
| `BLUE_API_VERSION` | root与host仍声明 `1.0.0`；examples、README、website 和 rc.1 release note均按 `^1.0.0`/Stable 推广 | CHANGE | #77 只作为 `1.0.0-beta.1` 合并；全部 V1 gate 通过后一次性升 `1.0.0` | api/release | **BETA-MERGE blocker**：不产生错误稳定承诺；V1 release report |

## 3. 相关 PR 处置

- PR [#72](https://github.com/dsh-blue/blue/pull/72) 与 #77 修改同一 UI 蓝图和索引，但保留了更旧的 API version、overlay/event 和实施裁决。它 MUST 关闭为被 #77 supersede，不能再单独合并。
- PR [#76](https://github.com/dsh-blue/blue/pull/76) 文件上可独立处理，但 capability 调研仍基于旧四能力和 `dock`。若合并，MUST 标成带日期的需求快照或先按 #77 更新；它不是规范来源。
- `docs/blue-ui-component-enhancement.md` 顶部仍称“产品实现尚未开始”，W5 段仍把已完成工作写成 future，而 W6 段又记录 W6-1..4 完成。Beta 合并前先消除这组内部矛盾；待本矩阵接管进度且真人验收完成后，再单独归档。
- #77 的 PR body 仍停在“只到 W3/G3”、177 files/2730 tests/check:lib 69 和旧 G3 acceptance；它 MUST 更新到当前 head、W4-W6 scope、实际门禁与仍缺的最终验收。G3 acceptance 早于 W4-W6，不能覆盖其后的全部实现提交。

## 4. #77 Beta 合并前顺序

以下工作保持在 #77 分支，完成后它才适合作为 Beta UI foundation 合并：

1. **OPEN - 冻结新基线**：合入本契约文档，把 PR 描述更新到 `c9e1600` 或当时最新 head，列出 Stable/Experimental/Rejected 实际状态和 W4-W6 scope。
2. **OPEN - 降级版本承诺**：`BLUE_API_VERSION` 与 host version 改为 `1.0.0-beta.1`；`^1.0.0` 示例、package README、website 和 rc.1 release note不得声称当前已经 Stable 1.0。
3. **OPEN - 隔离 control plane**：从 plugin-facing root 移除 owner helper；引入 composition authority/lease，禁止 `symbols.original` 成为 sibling 权限升级；aggregate/notification subscription 按 owner capability 窄化。
4. **OPEN - 收窄公开 vocabulary**：移除 generic `session.act`，隐藏或 authority-gate可直接 inject 的 raw session/projection reader与 requester；保留 negotiated readonly `session.read` seed但不把无 resource/epoch 的形状称为 v1 Stable。当前 flat manifest不能表达 optional，因此 `editor.extensions` 和 `editor.provider` 先退出 public Beta manifest、仅保留 bundle-internal/reference runtime；R2/R3 negotiated optional plane落地后再以 Experimental 公开，不能只改标签继续暴露。
5. **OPEN - 拆分 notifications**：public consumer 只保留 publish；普通 sibling 不能订阅其他插件通知，owner observe 进入受 authority 保护的 control plane。
6. **DONE foundation - 保持成熟实现**：canonical UI、panes/overlays、status/status provider、editor extension/provider、split session facade、consumer lifetime fencing、dock/view 删除和 packed examples不回退。后续权限收敛必须保住现有 unit/width/lifecycle 证据。
7. **OPEN - 修正文档事实**：package README/AGENTS 与 website区分“已实现 Beta”与“已冻结 Stable”；目标能力链接到 contract/roadmap。
8. **OPEN - 完整 worktree 验收**：在收敛后的 final head重跑全门禁、相关 packed 双线 fixture、`smoke:pty` 和统一专用 profile；profile 穿过 default、120/80/40、pane/overlay、status/editor provider、theme/session swap、editor input/completion/submit 与 unload/reload。用户明确 live-test 验收前不合并 #77。

### 当前自动证据

`c9e1600` 的 GitHub CI 与 website check 为 green。W6-4 final-head 报告记录 184 files / 2915 tests passed / 31 个既有条件性 unit skips、per-file 100% coverage、check:lib 87、check:pack 11 tarballs；CI 还执行 frozen install、typecheck、lint、diagrams、build、`check:examples` 和 `smoke:happy`，但不直接执行全部 package fixture 双线。

Packed evidence 包括 final-head examples 在 Harness `0.1.1-rc.2` / `0.1.1-rc.1` 各 7/7；W6-4 final-head 手工报告中的 `@dsh-blue/blue-app` package fixture 两条 Harness line 各 9/9（其中含 `session.read`、`session.act` 两个专用场景）、context/remote 各 7/7、OpenPencil/Lark 各 9/9，均无 fixture skip/failure且 cleanup 完成。Status provider 13/13、editor extensions 9/9 和 editor provider 11/11 的双线结果分别来自 `b5f3310`、`03cb7e0`、`14cbbb7` checkpoint，权限/稳定性修改后仍须在最终 head重跑。仓内 examples 证明 public tarball/host peer closure 和部分 lifecycle/width，不具备 `form`、required/optional/resource negotiation，也不是独立生态包，不能关闭 v1 三形态或外部消费者门禁。

CI 的 `smoke:happy` 不替代 final-head `smoke:pty`、统一 W4-W6 profile 或人工验收。旧 `blue-ui-g3` 验收早于 W4-W6，不能覆盖其后的全部实现提交，也不能作为当前 head 的 merge acceptance。

这一步不要求把整个 v1 roadmap 塞回 #77。manifest/schema 和新 ecosystem capability 在 master 上用后续小 PR 收敛，避免 #77 继续膨胀。

## 5. v1 收敛依赖顺序

```text
Beta merge
  -> JSON Schema + identity + semver + generated manifest type
  -> negotiated grants + public/control plane + error taxonomy
  -> existing UI surface cleanup (notifications split, status snapshot; dock 已完成)
  -> session.read resource/epoch + projection/conversation owners
  -> theme/settings owners
  -> editor Experimental split + provider namespace
  -> synthetic + ecosystem packed fixtures
  -> skills + bilingual docs
  -> 1.0.0 release gate
```

每一行关闭时必须把“当前实现、测试证据、owner、bundle row、fixture report”填回矩阵，不能只把状态改成 Done。

## 6. 归档条件

满足以下条件后，本矩阵移动到 `docs/history/blue-pr77-convergence-matrix.md`：

- #77 已按 Beta 规则合并；
- 所有 BETA-MERGE 行关闭；
- 所有 Stable v1 capability 通过 conformance；
- `BLUE_API_VERSION` 已发布为 `1.0.0`；
- 长期行为可完全由目标契约、生成 schema/API reference 和 package AGENTS 解释。

归档时记录最终 merge commit、协议发布 tag、fixture exact Harness lines、profile dogfood 和人工验收结论。
