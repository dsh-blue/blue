# Blue 插件协议 v1 发布路线

> 状态：**Active roadmap**
> 起点：目标契约通过评审，PR #77 以 `1.0.0-beta.1` foundation 合并
> 终点：`BLUE_API_VERSION 1.0.0`、机器契约、真实 owner、生态 fixture、skills 和中英文文档共同发布
> 目标契约：[blue-plugin-contract-v1.md](./blue-plugin-contract-v1.md)
> #77 控制矩阵：[blue-pr77-convergence-matrix.md](./blue-pr77-convergence-matrix.md)

本文只定义阶段、依赖、产物和退出门。Capability 语义只在目标契约定义；#77 当前状态只在收敛矩阵维护。

## 1. 发布完成定义

协议 v1 不是把 `BLUE_API_VERSION` 常量改成 `1.0.0`。以下产物必须同时完成：

- 可公开引用的 JSON Schema Draft 2020-12；
- 从 schema 生成的 TypeScript manifest type 和共用 runtime validator；
- Stable capability 的 public API、resource grant、真实 owner、fallback 和默认 composition；
- public data plane 与 bundle-owned control plane 的权限隔离；
- synthetic conformance kit 和三种插件形态的真实生态 fixture；
- 更新后的 plugin-development、plugin-migration、plugin-fixture、plugin-validation skills；
- 中英文 manifest、capability、quickstart、migration、testing 和 API reference；
- 当前/上一 Harness line、packed install、真实 profile 和人工验收证据。

依赖主链：

```text
规范冻结
  -> #77 Beta 安全合并
  -> JSON Schema
  -> generated TypeScript manifest + capability catalog
  -> negotiated public host / owner authority
  -> Stable capability owners
  -> synthetic + ecosystem fixtures
  -> skills
  -> bilingual developer docs
  -> API 1.0.0 release
```

Fixture 与实现按 capability 同步增加；“fixture 阶段”是关闭跨包、跨版本和生态总门禁，不是等代码写完才补测试。

## 2. R0：规范 PR

### 产物

- `docs/blue-plugin-contract-v1.md`：长期 Proposed target contract。
- `docs/blue-pr77-convergence-matrix.md`：临时 merge-control ledger。
- `docs/blue-plugin-api-v1-roadmap.md`：本路线。
- `docs/README.md` 与根 `AGENTS.md` 的 Target/Current/Active/Historical 权威指针。

### 退出门

- 三份文档不混写实现进度、长期语义和发布步骤。
- capability catalog、三种 form、manifest identity、required/optional/resource、Beta/v1 边界已经决策完整。
- PR #72 的 UI 蓝图和 PR #76 的 capability-gap 调研只作为输入，不与目标契约并列为规范真相。

## 3. R1：PR #77 Beta foundation

### 实施

截至审计 head `c9e1600`，#77 已完成可保留的 implementation baseline：canonical UI/compiler、panes/overlays、status/status provider、editor extension/provider、split session facade/app owner、consumer lifetime fencing、legacy dock/frontend renderer 删除、六个 runnable examples 与 user kit，以及 checkpoint 化的 current/previous Harness packed 证据。当前 CI 机械复跑 examples，W6-4 在 final head 手工补跑选定 package fixtures；status/editor provider 与 editor extensions 仍须 final-head 重跑。这些都是后续收敛的 seed，不是 Stable v1 结论。

1. 将 #77 rebase/merge 本规范，按最新 head 重跑矩阵并更新 PR body 的 scope、数字和剩余门禁。
2. 保留上述成熟 runtime；权限和命名收敛不得退回旧 renderer、dock 或未隔离 session facade。
3. 将 API/host version 改为 `1.0.0-beta.1`，删除“当前已经 Stable 1.0”的 README/website/release-note 表述。
4. 从 plugin-facing root 移除 owner attach、aggregate snapshot/observe、gesture mint 和强制 close。
5. 由 bundle composition 创建 canonical owner authority/lease并传给官方 owners；public sibling 即使访问 Cordis `symbols.original` 也不能获得 authority。
6. 从 Beta public vocabulary 移除 generic `session.act`，并隐藏或 authority-gate当前可直接 inject 的 raw session/projection reader与 requester；保留 negotiated readonly `session.read` seed但明确其 resource/epoch 尚待 v1 收敛。
7. 修正 editor extension static/runtime node 集合，并把 provider限定为 host-owned editor engine 外层 shell。R1 的 flat manifest尚不能表达 optional，因此两者先退出 public Beta manifest、仅保留 bundle-internal/reference runtime；R2/R3 negotiated optional plane落地后再以 Experimental 公开，不能只改稳定性标签。
8. 将 `notifications` 拆为 public publish 与 authority-protected owner observe；普通 consumer 不得订阅全局通知。

### 退出门

- hostile sibling fixture 无法 self-attach、读取 aggregate、observe 全局通知、mint gesture 或关闭别人的 overlay。
- #77 已有 unit、compile、packed、width 和 `smoke:happy` evidence 继续全绿；权限修改后的 final head重跑相关双 Harness 线 fixture。
- `smoke:pty` 与专用 worktree profile 完成 default、120/80/40 列、pane/overlay、status/editor provider、theme/session swap 和 editor input/completion/submit dogfood。
- 用户明确 live-test 验收后才合并；合并不等于 API v1 发布。

仓内 examples 只算 Beta/reference packed-distribution 基线：它们仍使用 flat `capabilities[]`、内部文件 `entry`，没有 `form`、required/optional/resources，也不是独立生态消费者，不能提前关闭 R2/R6 或 Stable capability 门禁。

## 4. R2：JSON Schema 与 manifest toolchain

### 单一 shape 真相与语义层

新增 `packages/api/schema/blue.plugin.schema.json`，使用 JSON Schema Draft 2020-12。Schema 是 manifest shape 的唯一机器真相；Schema 加版本化 semantic validator 构成完整机器契约。通过 package export `@dsh-blue/blue-api/schema/blue.plugin.schema.json` 和稳定网站 URL 同时发布。

Schema 必须表达：

- required identity/entry/API/product compatibility/form；
- `integrated | adapter | pure-ui`；
- capability `required`/`optional` discriminated request；
- capability version 和每项专用 `resources`；
- Stable/Experimental 结构约束；跨数组 name uniqueness 由共享 semantic validator 补充；
- strict additional properties 和可操作的 validation location。

工具链固定为：

- `json-schema-to-typescript` 只生成 `BluePluginManifest` 数据类型，生成文件不手改；runtime capability callback/API 类型继续由 TypeScript 手写并由 catalog 做 exhaustive check；
- Ajv 2020 供 API runtime parser、CLI validator 和 installer 共用 schema；
- `semver` 负责 range parse/intersection，替换字符正则和 API-major 近似；
- `check:plugin-schema` 重新生成到临时目录并 diff，校验 schema、generated TS、package export/files 和 published copy 无漂移。

`BLUE_CAPABILITY_CATALOG` 用 generated capability-name union 做 exhaustive key，记录 version、stability、resource schema id、owner、scope、fallback 和 limits。网站 capability 表从 catalog 生成或由 drift test 比对，不再手写名字列表。

### Validator 收敛

`script/blue-plugin-validate.mjs` 必须：

1. 从 `package.json.blue.manifest` 找文件，而不是碰巧寻找 root JSON；
2. 运行同一 schema/semantic validator；
3. 校验 id=package name、entry=exports subpath、`files` 和 packed tarball；
4. 根据 `form` 执行依赖/import/headless 规则；
5. 保留稳定 JSON report code/reproduce，不执行未信任 entry 完成静态阶段。

### 退出门

- positive/negative corpus 覆盖所有字段、form、capability、resource、semver 和 identity 分支。
- runtime parser、validator、installer 对同一 corpus 结论一致。
- 仓库至少有三个真实 `blue.plugin.json` 样例，分别覆盖三种 form。

## 5. R3：TypeScript public API 与协商 host

### Public API plane

`@dsh-blue/blue-api` root 只导出 Stable plugin-facing surface：

- `parseBluePluginManifest`、generated manifest types；
- `BlueResult` 和稳定 error taxonomy；
- readonly JSON/data/action primitives；
- `BluePluginHost.open()`、`BluePluginOpen`、grant/unavailable types；
- Stable `BlueCapabilityApiMap` 和按 grant 裁剪的 `BluePluginApi`。

Experimental editor types从明确的 experimental subpath/namespace 进入，不混入 Stable API report。Owner types MAY 公开用于官方包编译，但 authority value 只能由 bundle composition 创建，且不能从 public host 或 Cordis original 解出。

### Negotiation

- required capability/resource 采用原子 admission；optional 逐项降级并返回原因。
- grant 返回 exact capability version、实际 resource 和 host limits。
- capability owner generation 在每次 register/write/action 时复查。
- error code补齐 resource denied、timeout、stale、unavailable、internal isolation。
- API declaration report 进入 CI，破坏 Stable surface 必须显式评审。

### 现有 surface 收敛

- `notifications` 拆成 public publish 与 owner-only observe。
- #77 已将所有内置 dock consumer 迁到 bottom pane并物理删除 dock runtime/type/aggregate/bridge；本阶段只保留旧 manifest 的可操作迁移诊断和 `rg`/schema drift gate，禁止 compatibility 回流。
- 删除 `BluePluginDefinition.apply(api: unknown)`、inline legacy manifest 和 public owner aggregate。

### 退出门

- required/optional/partial-resource、owner absence/reload、cross-plugin isolation 全部有 host fixture。
- API root 不含 Deferred/owner power；exports/files/tsdown/check:lib 与 packed tarball一致。
- Beta manifest 有明确迁移错误，不能静默解释成不同权限。

## 6. R4：Stable capability owners

每个 capability 独立 PR/worktree，顺序由依赖决定。

### R4-A：现有 UI authority

收敛 `commands`、`status`、`panes`、`overlays`、`notifications.publish`、`status.provider`：

- 把现有 registry/bridge 接到 negotiated grant；
- status provider snapshot 去掉隐式 session 信息；
- limits 从硬编码实现提升为可观察 grant；
- 每项 owner subscription 按 capability 窄化。
- 以冻结的 dsh-status-bar minimal provider slice 验证 `status.provider` whole-provider ownership 与 fallback；只有 in-repo reference fixture、没有外部 packed port 时不得标 Stable。

### R4-B：Readonly session/projection

1. 保留 #77 已拆出的 `session.read` readonly facade：public consumer 只有 `current/subscribe`。followup/steer/interrupt dispatcher MAY 继续作为 app owner内部实现，但当前通用 `BlueSessionRequester` Cordis service必须删除或改为 composition authority-gated，普通 sibling不能 inject；它 MUST NOT 重新进入 reader、公开 service或 public capability vocabulary。
2. snapshot 按 identity/cwd/status/mode/model grant 投影并带显式 `sessionEpoch/revision`；订阅 replay、stale 判断和 action reference都以 epoch为界。
3. 在 app/harness-adapter 建 `projections.read` allowlist gateway；返回一致 cut、`asOfSeq`、有界 immutable value。
4. session switch、same-id new epoch、resource denial、key unload、late callback 和 duplicate/older sequence 都有确定结果。

### R4-C：Conversation extension points

- `conversation.read` 提供 cursor/page-size 有界 normalized entries；不暴露 raw event log。
- `conversation.navigate` 只改变当前 frontend viewport，不修改 session。
- `conversation.itemActions` 注册 label/applicability/handler；Blue 在 dispatch 前复查 item ref epoch/revision并提供 gesture/signal，插件调用自己的 domain service。

Rewind、Message Edit 和无 domain mutation 的 Bookmark/Tag reference fixture 必须共用该扩展点，禁止为某一个插件新增业务字段。Peak Indicator 走 additive status，不计作 item-action 泛化证据。

### R4-D：Theme 与 settings

- `theme.provider` 注册 semantic token candidate；用户选择、token validation、fallback、unload/swap 与 status provider 同等级。
- `settings.sections` 只管理 Blue 设置 UI composition；schema/value/commit/conflict/persistence 由插件直接 inject `dsh-settings`。
- Catppuccin 不能复制 JSON 到 Blue 包，也不能输出 ANSI；它只注册 theme candidate 和可选 settings section。

### 每项退出门

- 至少两个独立消费者（一个 Blue official/reference、一个独立生态包）、absence fallback、Fiber unload 和 package/bundle composition 齐全。
- read capability 有 replay/resume/stale；action 有 gesture/abort/stale/double-submit；renderer contribution 有 width/failure isolation；provider 有 swap/LKG/breaker/fallback。
- packed fixture current/previous Harness line 均执行，无 skipped。

## 7. R5：Editor Experimental

在保留 #77 editor runtime 的基础上，按最小权力拆分：

1. `editor.decorations`：先迁 passive before/after、hint、diagnostic、action。
2. `editor.completions`：独立 trigger/query、mux、timeout、abort、stale 和 result cap。
3. `editor.draft.read`：revisioned readonly draft snapshot。
4. `editor.draft.write`：expected revision 的结构化 insert/replace；与 history/IME transaction一致。
5. `editor.submit.transform`：固定排序、逐项 timeout、abort、rollback，提交清空前完成 barrier。

全部只能 optional，owner/fixture 缺失不阻止插件加载。Composer History 验证 draft read/write 和 session/editor reload；`@/#` completion 与 submit transformer 各自使用独立 fixture。

Composer History 的 v1 fixture 只验证显式 history command/overlay 与 draft read/write，不承诺原 Web 版的 ArrowUp edge recall 或 Ctrl+R。精确按键体验依赖尚未泛化的 contextual editor-key seam，列入 Deferred 独立设计；不得把 raw key handler 塞进上述五个 capability，也不得因此阻断 `1.0.0`。

#77 已实现的 `editor.provider` owner、persisted user selection、actual-width dry render、同 editor/focus shell swap、LKG/breaker/default fallback 和 stale/unload fencing作为本阶段基础保留，不重新实现。本阶段把它迁入明确的 Experimental schema/catalog/subpath，并冻结为 host-owned editor engine 外层的 shell provider：candidate 必须恰好贡献一个 `editor-control`，不得获得 draft/cursor/history/undo/IME、raw key 或 editing-engine ownership。

它发布为 Experimental 前必须进入 optional schema/catalog/subpath，冻结 activate/dispose 或“纯无状态 shell无需 hook”的 public lifecycle语义，完成 final-head current/previous Harness reference packed fixture，并在统一 profile 通过 draft/history/mode/attachments/focus/IME、failure rollback、session swap 和 unload/reload 的真人验收。固有 snapshot 不再隐式提供 mode；需要 mode 的插件另申请 `session.read` grant。它不进入 Stable catalog、不计作三种 form 的 Stable 外部证据；独立生态 provider和其余 Stable 门禁留给未来另开的 1.x 晋升提案。

## 8. R6：Conformance 与生态 fixture

### Synthetic conformance kit

#77 已提供可复用的 `script/blue-plugin-fixture.mjs`、`script/blue-examples-fixture.mjs`、throwaway packed install、peer closure 和 current/previous Harness lanes。R6 在该基础上扩展或拆出 versioned kit，使每个测试包从 `npm pack` tarball 安装，只 import public exports。报告必须保持：

```text
declared == executed
skipped == []
failures == []
fixtureCleaned == true
```

统一的是场景词表和 capability -> required scenarios 映射，不要求无关 fixture 假跑不适用场景。词表包含 manifest negotiation、resource denial、projection replay/resume、action abort/stale、provider swap/fallback、unload/reload、late callback、20/40/80/120 width、bundle composition、当前/上一 Harness exact line；每个 fixture 的全部 declared/applicable 场景必须执行，`skipped` 仍为空。

#77 的六个 executable examples 继续作为 Beta/reference distribution corpus，但它们仍是 flat `capabilities[]`，没有 `form`、required/optional/resources negotiation，也不是独立生态 package。R6 必须将其迁到目标 schema，并另用真实外部 package 关闭三种 form 与独立消费者门禁；仓内 `blue-user-kit` 组件库和 `blue-ecosystem` composition bundle都不构成第四种 form。

### 三形态候选与证据等级

下表中的 `form` 指目标发布的 Blue entry，不是某个生态项目的固有属性。审计冻结于 2026-08-28/29；commit 是 fixture 可复现基线，不是要求永远跟随的版本。Fixture MAY 暂存于 Blue conformance 仓或固定 commit fork，但必须记录 upstream commit、补丁、同步/删除条件、发布/代码 ownership 和作者合作状态。同一功能若由上游同包发布就是 `integrated`，由独立 `*-blue` 包只消费其 service 则是 `adapter`；fixture manifest 必须按实际 ownership 选择，不能按本表名称猜测。

| Form | 候选与冻结证据 | 目标 Blue 边界 | 当前可行性 | v1 角色 |
| --- | --- | --- | --- | --- |
| pure-ui | [Catppuccin](https://github.com/NoNameLeGo/dsh-catppuccin-theme) `a44df0045d81` | 四套 theme JSON -> `theme.provider`；可选 `settings.sections`，持久化走 `dsh-settings` | 高；现有 TUI 会写 `~/.dsh-tui/themes`，新 Blue entry 必须直接注册 semantic tokens，且不得启动 sibling Web/update route | **首批 POC / Stable blocker** |
| pure-ui | [Conversation Navigator](https://github.com/gjj-star/dsh-conversation-navigator) `9682972130d8` | `conversation.read`、`conversation.navigate`、`session.read`、`panes`，可选 `commands` / `settings.sections` | 高；当前 browser entry 与空 host shell 已分离，重点是分页、session switch、stale jump、width | 第二波 Stable evidence |
| pure-ui | [Composer History](https://github.com/PerryLink/dsh-composer-history) `16feb04aaaaf` | Experimental `editor.draft.read/write`、`conversation.read`、`overlays`、`settings.sections` | 中；v1 只迁显式 history/draft 子集，ArrowUp/Ctrl+R 等 contextual key seam Deferred | Experimental，**不阻断 1.0** |
| adapter | [Cost Meter](https://github.com/Han-1413141/dsh-cost-meter) `56455e17848d` | 独立 Blue adapter 直接 inject 公开 `costMeter` service，并申请 `projections.read` resource `{ keys: ['costUsage'] }`；只向 `status` / `panes` / `commands` / `notifications.publish` / `settings.sections` 投影 | 高；已有公开 service 和 projection，不产生 `cost.*` Blue capability，也不复制费用真相 | **首批 POC / Stable blocker** |
| adapter | [Turn Rewind](https://github.com/Anionex/dsh-turn-rewind) `d3734cb183a5` | 独立 Blue adapter inject `rewind` service 后消费 `conversation.itemActions`、`overlays` | 阻塞；当前只有 `/rewind` command 和 raw Agent/Session 执行。作者需先抽 `list/preview/execute` renderer-neutral service；若 Blue face 改由上游同包拥有，form 应改为 integrated | 前置条件项；可由 Message Edit + Bookmark/Tag reference 补其 v1 证据 |
| integrated | [dsh-context](https://github.com/bowenliang123/dsh-context) `6d17588a5672` | 同包 headless projection 与独立 Blue entry；消费 `projections.read` / `status` / `panes` / `overlays` / `commands` / `settings.sections` | 高；先做 headline、composition、recent events，不复制完整 Web dashboard | **首批 POC / Stable blocker** |
| integrated | [OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) `906ff9c2fcda` | domain/tool 继续 headless；Blue v1 只验证 canonical text/diff fallback、signed-meta elision 和 `notifications.publish` | 当前 `@dsh-blue/blue-openpencil` 是独立 adapter；本行只在上游作者拥有同包 Blue entry 后成立。Rich workbench 依赖 Deferred tool-presentation，不能搬 Web canvas 或 capability bearer | v1 negative/fallback；rich UI 不阻断 1.0 |
| integrated | [Lark](https://github.com/sugarforever/dsh-lark) `ee639df50fc7` | 上游同包 Blue entry 消费 `commands` / `notifications.publish` / `settings.sections`；domain runtime 独立 | 当前 `@dsh-blue/blue-lark` 是 loopback HTTP compatibility adapter，不是 integrated。上游公开 service/内置 Blue face 后删除 adapter | 未来 integrated，非首批 blocker |

表外另保留两条不同性质的证据：

- [Blue Remote](https://github.com/GeekCmore/dsh-remote) `423c736869aa` 是 transport/protocol infrastructure fixture，验证 negotiate、seq resume、lease、question/approval、reconnect 和 unload。它当前不消费 Stable UI capability，因此不冒充三种 Blue plugin form；待 Deferred session/frontend provider 契约再重新分类。该项目也不能与市场中同名 remote 包混淆。
- [Modlens](https://github.com/liustack/modlens) `147356e6dde0` 是 zero-Blue-API negative fixture：它继续只通过 Harness tool/provider 工作，Blue 无 manifest、无专用 capability 也能呈现通用结果。该用例防止“为了市场覆盖给每个 domain 发明 capability”。

Conversation item-action 的外部压力基线另冻结为 [Message Edit](https://github.com/Moeblack/dsh-message-edit) `b78a167064ca`，但它与 Rewind 一样要先抽 renderer-neutral service。Bookmark/Tag 是明确标记的 in-repo reference fixture，不伪装成外部生态消费者；创建时记录自身 commit。

[dsh-status-bar](https://github.com/Starlight-bananice/dsh-status-bar) `128a7f3d1256` 是 `status.provider` 的独立生态候选。首个 fixture 严格限定为 minimal pure-ui provider slice，只消费 `session.read` 的 status/cwd/mode/model 和 sanitized additive entries；完整 17 段与费用历史版是后续 integrated 目标，需要 allowlisted `projections.read`，并先把 JSONL/HTTP ledger 抽成 renderer-neutral Cordis service。只有该外部 slice 通过 packed/provider-swap/width 门禁后，才满足 Stable 的外部消费者条件。

[Peak Indicator](https://github.com/future007s/dsh-peak-indicator) `887bbe7040f1` 是 additive `status` 候选，只验证峰谷时段徽标与 timer/unload；它不替代 `status.provider`，也不计作 conversation item-action consumer。

候选池是 discovery/fixture portfolio，不是等权 release blocker。`1.0.0` 的硬门是三种 form 各至少一个 Stable packed fixture、每个 Stable capability 的 owner/consumer/fallback/lifecycle 证据，以及所有声明场景零 skip；Experimental、Deferred 或明确阻塞的候选不因尚未迁移而阻止发布。反过来，首批三个 POC 也不能替代它们没有覆盖的 Stable conversation/provider 证据，或另行声明的 editor Experimental 证据。

### 首批 POC

按实现风险优先完成：

1. Catppuccin：最快证明 pure UI/theme provider；
2. Cost Meter：证明公开 service/projection 的窄 adapter；
3. dsh-context：证明 integrated projection 到 TUI。

选择依据来自 dsh-market 2026-08-28 registry snapshot：Catppuccin 为 20 stars / 5,806 downloads，Cost Meter 为 195 / 17,152，dsh-context 为 1,037 / 32,099。三者兼顾可见用户量和低到中等迁移风险，且不会用同一 capability 的三个变体冒充架构覆盖。

三者 packed fixture 通过后再联系作者。每个合作包携带 frozen upstream commit、可安装 tarball、可运行 profile patch、迁移 diff、短终端录屏、machine-readable fixture JSON、fallback 表和建议代码 ownership，而不是只发送合作设想。它们共同作为联系 dsh-market 的 Blue 能力 demo。下载量是快照中的相对优先级信号，不是协议或长期流量承诺。

dsh-market 不作为 v1 阻断 fixture。在审计基线 [`d5902420b175`](https://github.com/dsh-market/dsh-market/commit/d5902420b175) 中，catalog/安装/profile 更新仍主要封在 HTTP routes；Update API v1 仍为 beta，范围只覆盖 check/start/observe/rollback/restart，不足以支撑完整 TUI 市场。Blue 不能调用私有 route、复制 pnpm/profile/restart 逻辑或定义 `market.install` capability。

合作前置是 dsh-market 抽出 typed/versioned renderer-neutral Cordis service/controller，至少覆盖 catalog/search、installed/check、install/update/uninstall/toggle、operation progress/cancel/rollback；同时固定 error taxonomy、policy/authorization 和 lifecycle。Service mutation 接受 AbortSignal、profile scope 和 dsh-market 自己的 authorization context，并由 dsh-market Fiber 持有恢复与 restart 策略；Blue adapter 在调用前消费 Blue user gesture，不能把 Blue token 泄漏进 domain service。Blue 只用 `commands` / `panes` / `overlays` / `notifications.publish` 呈现，成为第一个非 Web consumer。现有 beta Update API 可做受限 update-status pilot，但不能被描述为完整 market 集成。Agent Teams、Browser 等同样作为后续 capability discovery，不阻塞 1.0。

## 9. R7：Skills 与开发者文档

Skills 在 API 和 fixture 稳定后更新，避免教会开发者一套过期接口。

| Skill | 必须更新的行为 |
| --- | --- |
| `plugin-development` | 选择三种 form、生成 package pointer/manifest、区分 direct inject 与 Blue capability、required/optional/resource/fallback |
| `plugin-migration` | 输出 Domain/Projection/Action/UI/Composition、form、scope、adapter 删除条件；识别 HTTP closure 和不需要 Blue API 的插件 |
| `plugin-fixture` | 生成 packed current/previous-line 场景；按 capability 自动选择 replay/abort/stale/swap/width/unload；禁止 skipped 充当证据 |
| `plugin-validation` | schema、public/control plane、package export/files/tsdown、Fiber、bundle/profile/human acceptance 一体门禁 |

每个 skill 至少有 integrated、adapter、pure-ui 和 zero-API 四类 eval；输出引用生成的 capability catalog，不内嵌名字副本。

开发者文档最后生成并保持中文源、英文镜像：

- concepts：三种 form 与四种架构职责；
- manifest：schema、identity、entry、compatibility、capability negotiation；
- capabilities：生成的 Stable/Experimental 表、resource/fallback；
- quickstart：三个最小样例，实际包含 `blue.plugin.json` 并从 tarball 安装；
- migration：从 flat Beta manifest、dock、notifications、session/editor 旧面迁移；
- testing：validator、packed fixture、previous Harness、width/profile/human gate；
- API reference：TS declaration、schema URL、error taxonomy 和版本政策。

所有教程样例本身进入 packed fixture。网站 build、链接、中文/英文结构 parity 和 catalog drift 是 CI gate。

完成后归档 `blue-api-design.md`、PR #77 的 UI blueprint 和已结束的 frontend-runtime cutover 套件；保留 `blue-frontend-architecture.md` 作为原则、package AGENTS 作为当前实现。归档移动单独提交，统一修复根 AGENTS、`CODEX-IMPLEMENTATION-GUIDE.md` 和 docs links。

## 10. R8：`1.0.0` 发布门禁

按以下顺序关闭：

1. schema、generated TS、runtime/validator/installer corpus green；
2. Stable capability catalog 每项 owner/consumer/fallback/fixture complete；
3. API declaration report 确认 root 无 Experimental/Deferred/control-plane 泄漏；
4. 三种 form 各至少一个 Stable 生态 fixture、Stable catalog 的逐项证据和 Modlens zero-API negative fixture 在 current/previous Harness line green；候选表中 Experimental/Deferred/blocked 项不计作未完成 blocker；
5. skills eval 与中英开发者文档 green；
6. 全仓 test、coverage、typecheck、lint、build、check:lib、check:pack、diagrams、website build 和 smoke green；
7. 独立 `blue-<tag>` profile 覆盖 install、unload/reload、provider/theme/session swap、120/80/40 列和首批 POC；
8. 用户 live-test 并明确验收；
9. 将 API/host version 从 `1.0.0-beta.1` 改为 `1.0.0`，发布 schema stable URL、packages 和 migration notes；
10. 从 registry 新建干净 profile 做 install smoke，记录 exact artifacts/Harness line。

任何 skipped fixture、任一已声明 Stable capability 缺少真实 owner、只有 Web route 的业务 API、缺失上一 Harness line、缺失人工验收都阻止 `1.0.0`。Blue 产品 release 仍可保持 `0.x`，不需要为了协议 v1 人为提升产品 major。

## 11. 工作方式

- 每个阶段使用独立 worktree 和小 PR；不把所有收敛重新塞回 #77。
- 每个 capability PR 同时改 code、tests、package AGENTS、bundle row、fixture 和当前实现文档。
- 目标契约变更必须先通过协议评审；实现进度只更新矩阵/roadmap。
- 用户可见行为按仓库规则安装到 worktree 专属 profile，真人验收前不合并、不删除 profile。
- 路线完成后本文归档到 `docs/history/`，由 release notes 和生成 API reference 接替。
