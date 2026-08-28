# PR #77 插件协议收敛矩阵

> 状态：**Active merge control**
> 基线：`master@1d0f01e`
> 审计对象：PR [#77](https://github.com/dsh-blue/blue/pull/77) `p2/ui-api-refactor@03cb7e0`
> merge-base：`1d0f01e`，PR 分支领先 33 commits
> 目标规范：[Blue 插件协议 v1 目标态契约](./blue-plugin-contract-v1.md)

2026-08-29 审计时，#77 的 CI 与 website check 为 green，但 GitHub 状态仍是 `BLOCKED / REVIEW_REQUIRED`；自动检查不替代本矩阵要求的 profile live acceptance。

本文只回答“PR #77 的现有实现如何进入 master，并继续收敛到插件协议 v1”。它不是长期 API 真相。#77 合并并完成 v1 收敛后，本文移入 `docs/history/`。

## 1. 总体判断

PR #77 已形成四条可保留的纵向切片：

1. canonical `BlueUiNode`、builders、admission validator 和唯一 pi-tui compiler；
2. managed panes/overlays 与 focus、gesture、abort、buffer/replay；
3. additive status 和用户选择的 `status.provider`；
4. revision-fenced editor extension owner、completion/submit/action runtime 和 packed fixture。

它尚未形成可直接冻结的 `1.0.0` 插件协议。当前三层状态并不一致：

| 层 | 数量 | 当前事实 |
| --- | ---: | --- |
| manifest vocabulary | 10 | 包含 `session.read/session.act`、`editor.extensions/editor.provider` |
| public host implemented set | 8 | 不含两个 session capability；另有内部 legacy `dock` |
| 默认 bundle active owner | 7 | commands、status、notifications、panes、overlays、editor.extensions、status.provider；另有 legacy dock owner |

`editor.provider` 只有 type/registry，没有 selection/swap owner；`session.read/session.act` 仍明确拒绝。manifest、validator、website 与 public root 还存在身份、权限和稳定性矛盾。

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
| core validator/compiler | core 是唯一 admission/compiler 和 pi-tui boundary；已有 exhaustive/width tests | KEEP | 非 core 包不接触 pi-tui、ANSI、terminal width/focus；compiler failure 隔离 contribution | core | V1：2..120 width/hostile node；public kit packed import |
| `panes` | host registry、每插件配额、buffer/replay、surface bridge、semantic events、responsive layout 已实现 | KEEP | Stable managed surface；明确 renderer owner 暂未 attach 时的 retained queue/replay | core surface owner | V1：header/right/bottom、narrow、owner unload/reload、focus restore、late event、20/40/80/120 packed fixture |
| `overlays` | one-shot gesture、capturing 配额、FIFO/latest-wins、abort/close/focus restore 已实现 | KEEP | Stable managed overlay；普通插件不能主动开 capturing overlay | core overlay owner | V1：gesture expiry、double submit、unload、owner swap、timeout、hostile sibling |
| additive `status` | narrow recursive status node、独立 revision、transcript owner/compiler 已实现 | KEEP | Stable additive status；非交互、不能夺取 footer composition | transcript status owner | V1：external status packed fixture、width、render throw、unload/reload |
| `status.provider` | inert candidates、settings selection、dry render、same-session LKG、cross-session default、3/60s breaker、fallback 已实现 | CHANGE | 保留 provider 事务；专用 snapshot 不隐式带 session id/cwd/model；需要时显式申请 `session.read` resource；加入 session epoch/revision | transcript composition + settings | V1：owner absent、theme/session switch、stale generation、selection persistence、failure attribution、真实 profile swap |
| `commands` | interaction bridge 映射到 Harness commands，具备 AbortSignal、owner-minted gesture、duplicate rollback、unload | KEEP | 只承诺 Blue-local UI command；能直接注册 Harness command 的 domain 插件继续走 host service | interaction owner | V1：packed command、late settlement/unload、gesture chain；文档避免双 command discovery |
| `notifications` | 一个 capability 同时返回 publish/subscribe；owner bridge 使用全局 observer | CHANGE | public 只保留 `notifications.publish`；observe 属 owner control plane；定义 dedupe/replace/duration/priority 和动态 rate limit | notification model + interaction renderer | V1：publisher 隔离、普通插件不能观察其他插件、sink absent、rate/dedupe、unload/late publish |
| `editor.extensions` | `5a24f54` 后已有真实 owner：passive node admission、`/ @ #` completion、action gesture、submit transform、revision/abort/unload 和 packed fixture | KEEP + CHANGE | Beta 保留完整纵向实现；v1 capability 拆为 decorations、completions、draft.read、draft.write、submit.transform，均为 Experimental/optional | interaction editor owner | BETA-MERGE：不得称 Stable；`before/after` 静态 `BlueUiNode` 与 runtime passive subset 收窄一致。V1：逐项最小授权；真实 editor input/completion apply/submit profile 路径；draft/history/IME 不丢 |
| `editor.provider` | public type、registry 和 shell validator 存在；默认 bundle 没有 selection/swap owner，`open()` 返回 absent | REMOVE (Stable) | 不进入 v1 manifest/root；待完整 capture/abort/dispose/activate/restore 和第二个真实 provider 后另行提案 | future interaction/core owner | BETA-MERGE：从 Stable capability 声明移除或明确 Deferred。未来：draft/history/mode/attachments/focus/IME、failure rollback、unload |
| flat `capabilities[]` | required/optional、capability version、resource grant、form 均不可表达；`open()` all-or-nothing | CHANGE | 对象式 required/optional request；每项 `{name, version, resources?}`；返回 negotiated grants | api/schema + host | V1：positive/negative schema corpus；required fail、optional degrade、resource subset/denial、duplicate cross-group |
| manifest identity | inline 字段多为 optional；分发文档要求 root JSON；quickstart 不生成 JSON；id/name/row 是否相等互相矛盾 | CHANGE | `package.json.blue.manifest` 唯一发现入口；id=package name；entry=exports subpath；Cordis name/row id 独立 | schema + installer | V1：packed package、exports/files、runtime import 同一 JSON、identity negative corpus |
| `integrity` author field | manifest 接受作者提供的 tarball digest | REMOVE | integrity/source commit 放 installer receipt/lock，不能由被验证包自证 | installer | V1：安装 receipt 和 source pin fixture；schema 拒绝 author integrity |
| semver admission | manifest 用字符正则；host 只用 `/^\^?1/` 近似 API major | CHANGE | 真实 semver range parse/intersection；API、product、Harness、Node、capability version 分离 | schema/runtime admission | V1：prerelease、union、upper bound、invalid range corpus |
| `session.read` | manifest 有名字，host 明确 denied；`BlueSessionReader` 同时含 `current/subscribe/request`，snapshot 无 epoch/revision | CHANGE | 纯 readonly facet；按 identity/cwd/status/mode/model resource 裁剪；snapshot/subscription 带 epoch/revision | app + narrow harness adapter | V1：same-id new epoch、session switch、headless absence、bounded snapshot、no Agent/Session/write leakage |
| `session.act` | manifest 有名字但永远 denied；未来若复用 `BlueSessionReader` 会让 read grant 获得 followup/steer/interrupt | REMOVE | v1 无通用 session write；按真实业务 action 或 `conversation.itemActions` 扩展点设计 | domain plugin owns action | BETA-MERGE：移出公开 vocabulary。V1：negative schema/API fixture |
| owner helper root exports | api root 导出 attach/snapshot/subscribe/mint/close；官方 bridge 用 Cordis `symbols.original` 解包后调用 | CHANGE | public host 只有 version/open/data facets；control plane 要求 bundle composition 创建的 authority/lease，普通 sibling 无法获得 | bundle + api host | **BETA-MERGE blocker**：hostile sibling 证明 unwrap/self-attach/snapshot/mint/close 均失败；官方 owner reload 保持正常 |
| aggregate owner snapshot | 一个 snapshot 同时含全部 capability contribution 与 revisions | CHANGE | owner subscription 按 capability/lease 窄化；owner 不能观察无关插件数据 | capability owners | BETA-MERGE：至少隔离公共 root。V1：per-owner subscription 和 cross-capability negative fixture |
| `BluePluginDefinition.apply(api: unknown)` | public type 无 loader/runtime consumer | REMOVE | v1 使用真实 Cordis entry + parsed manifest + negotiated typed API；不保留占位符 | api/loader | BETA-MERGE 或首个 schema PR 删除；compile negative fixture |
| error taxonomy | stale/timeout/unavailable/resource denial 不可区分，多处压入 `BLUE_ACTION_REJECTED/ABORTED` | CHANGE | 采用目标契约的 negotiation/admission/execution 错误分类；无异常跨边界 | api | V1：每个 code 有可复现 fixture，message 不承担机器语义 |
| legacy `dock` | public validator 拒绝，但 `BlueHostManifest`、host aggregate、transcript bridge和 bundle e2e 仍消费 | REMOVE | 官方 bottom surfaces 迁到 `panes` 后物理删除 type/registry/snapshot/bridge；旧 manifest 给明确迁移诊断 | transcript/core panes | V1：`rg` 无 public/internal dock compatibility；bundle e2e 改走 bottom pane |
| legacy `panels/editor/tools` | migration validator 仍识别这些旧名字；无 v1 owner/API | REMOVE | 不进入新 schema、catalog 或 API root；validator 只返回明确迁移诊断 | schema/validator | V1：negative corpus；网站不再把旧名字描述为 future capability |
| `projections.read` | app 内部 reader 可按任意字符串返回 `unknown`，没有 public resource gate | ADD | manifest 精确 key allowlist；一致 cut、size bound、epoch/asOfSeq、key unload 语义 | app/harness adapter | V1：dsh-context + Cost Meter，replay/resume、duplicate/older seq、key unload、late callback |
| conversation APIs | conversation projection存在，但无 public bounded reader、navigate 或 item action registry | ADD | `conversation.read/navigate/itemActions`；item action 只调度，业务执行留在插件 service | conversation + transcript/interaction | V1：Navigator、Rewind、Message Edit、Bookmark/Tag reference；pagination/stale/gesture/unload |
| `theme.provider` | frontend theme model存在；公开插件没有 provider negotiation/selection contract | ADD | semantic token candidate、用户选择、validation、fallback；无 ANSI/CSS | frontend/core composition | V1：Catppuccin，token completeness、swap failure、unload、narrow/width |
| `settings.sections` | Blue 有内部 settings panel 和 dsh-settings owner；无第三方 section contract | ADD | 只贡献 settings UI；plugin config/schema/persistence 直接 inject `dsh-settings` | interaction settings UI | V1：Catppuccin + Lark，read-only backend、conflict、unload；证明无 Blue storage |
| JSON Schema / TS manifest | 没有独立 schema；script 只检查字段存在且不复用 runtime validator | ADD | Draft 2020-12 schema 为源，生成 TS type；Ajv/validator/installer/runtime 共用；drift gate | api/schema | V1：schema corpus、generated diff、published URL/subpath、真实 tarball |
| public API plane | owner helpers、Stable/Experimental、plugin-facing types混在 root | CHANGE | root 只导出 Stable；Experimental 走明确 subpath/标记；owner authority 不可由普通插件取得 | api package | BETA-MERGE：稳定性声明收窄。V1：API declaration report、exports/files/tsdown triangle |
| docs/skills | website manifest/quickstart/seams、package README、skills 和代码 capability 状态漂移 | CHANGE | contract 是目标真相；package AGENTS 是当前实现；能力表从 schema/catalog 校验生成；中英同步 | docs + package owners | BETA-MERGE：不得把 absent/denied 写成 Stable。V1：docs build、parity、examples packed install、skill eval |
| `BLUE_API_VERSION` | root与host已经声明 `1.0.0` | CHANGE | #77 只作为 `1.0.0-beta.1` 合并；全部 V1 gate 通过后一次性升 `1.0.0` | api/release | **BETA-MERGE blocker**：不产生错误稳定承诺；V1 release report |

## 3. 相关 PR 处置

- PR [#72](https://github.com/dsh-blue/blue/pull/72) 与 #77 修改同一 UI 蓝图和索引，但保留了更旧的 API version、overlay/event 和实施裁决。它 MUST 关闭为被 #77 supersede，不能再单独合并。
- PR [#76](https://github.com/dsh-blue/blue/pull/76) 文件上可独立处理，但 capability 调研仍基于旧四能力和 `dock`。若合并，MUST 标成带日期的需求快照或先按 #77 更新；它不是规范来源。
- `docs/blue-ui-component-enhancement.md` 在 #77 中既有目标蓝图也有已经过期的“尚未实现”进度。Beta 合并前先修正事实；待本矩阵接管进度且真人验收完成后，再单独归档。

## 4. #77 Beta 合并前顺序

以下工作保持在 #77 分支，完成后它才适合作为 Beta UI foundation 合并：

1. **冻结新基线**：合入本契约文档，更新 PR 描述到 `03cb7e0` 或当时最新 head，列出 Stable/Experimental/Deferred 实际状态。
2. **降级版本承诺**：`BLUE_API_VERSION` 与 host version 改为 `1.0.0-beta.1`；`^1.0.0` 示例不得声称当前可用。
3. **隔离 control plane**：从 plugin-facing root 移除 owner helper；引入 composition authority/lease，禁止 `symbols.original` 成为 sibling 权限升级。
4. **收窄公开 vocabulary**：删除 `session.act` 和 Stable `editor.provider`；`session.read` 在 owner 落地前不得伪装可用；editor extensions 标 Experimental。
5. **保持成熟纵向切片**：canonical UI、panes/overlays、status、status provider、editor runtime 不回退；所有现有 unit/packed/width 证据继续绿。Editor packed fixture 已证明 host binding、replay、abort 和 unload，但 profile dogfood 还要穿过真实 input、completion apply 与 submit barrier。
6. **修正文档事实**：package README/AGENTS 与 website 只能描述实际 owner；未实现目标链接到本文和 roadmap。
7. **完整 worktree 验收**：全门禁、专用 profile dogfood、用户 live-test；未明确“验收通过”前不合并 #77。

这一步不要求把整个 v1 roadmap 塞回 #77。manifest/schema 和新 ecosystem capability 在 master 上用后续小 PR 收敛，避免 #77 继续膨胀。

## 5. v1 收敛依赖顺序

```text
Beta merge
  -> JSON Schema + identity + semver + generated manifest type
  -> negotiated grants + public/control plane + error taxonomy
  -> existing UI surface cleanup (notifications split, dock removal)
  -> session/projection/conversation owners
  -> theme/settings owners
  -> editor Experimental split
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
