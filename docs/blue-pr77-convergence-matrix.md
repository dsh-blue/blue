# PR #79 设计基线与 PR #77 Beta 合并手册

> 状态：**Active merge and delivery control**
> 设计 PR：[#79](https://github.com/dsh-blue/blue/pull/79)
> 审计基线：`master@1d0f01e`
> PR #77 审计对象：`p2/ui-api-refactor@9a6a255`
> 已验收运行候选：`cf8b3bd`；`9a6a255` 只记录该验收事实
> 长期 API 语义：[Blue 插件 API v1 设计规范](./blue-plugin-contract-v1.md)
> PR #77 之后的阶段出口：[Blue 插件 API v1 发布路线](./blue-plugin-api-v1-roadmap.md)

本文是从 PR #79、PR #77 到插件协议 `1.0.0` 的执行入口。它负责说明每个 PR 可以发布什么、合并顺序、退出门和证据；API 长期语义只在设计规范定义，阶段产物只在路线图展开。

PR #77 已吸收 PR #72 的设计输入；PR #72 不再作为独立合并前置项。本手册不得被解释为要求 PR #77 一次实现整个 v1 roadmap。

## 1. PR #79 的发布边界

PR #79 是 **docs-only design and control PR**。合并后进入 `master` 的是可公开评审的设计基线，不是可供插件作者依赖的运行时发布。

### 1.1 PR #79 合入什么

- `blue-plugin-contract-v1.md`：Draft 机器/API 目标和七项 Stable 边界；
- `blue-plugin-host-lifecycle.md`：Draft 内部权限、generation、owner gap 和 restore 规则；
- 本手册：PR #77 的 Beta 合并步骤与后续独立 PR 队列；
- `blue-plugin-api-v1-roadmap.md`：Beta 到 Stable 的阶段依赖和发布门；
- `docs/README.md` 与根 `AGENTS.md`：把当前实现、目标规范和执行文档指向各自权威来源。

这些文档在 GitHub 上公开，但都必须保持 Draft/Active 标记。公开可读不等于公开 API 已发布。

### 1.2 PR #79 不发布什么

PR #79 MUST NOT：

- 修改 Blue runtime、package manifest、API/host version、schema、generated types、validator、installer、examples 或 bundle composition；
- 发布 npm package、dist-tag、GitHub Release、协议 tag 或 product/protocol mapping；
- 把 website 开发手册改写成可运行的 v1 quickstart，或触发“v1 已可用”的 Pages 文案；
- 修改创造模式 runtime、preset persona 或可执行作者 skill；
- 宣称七项 capability 已 Stable、PR #77 已满足本手册，或沿用旧 exact head 的真人验收作为 hardening 后验收；
- 联系生态作者、发布邀请 Issue、提交上游代码 PR 或联系 dsh-market。

Website 开发手册、两类 skill 和创造模式持久包属于 PR #77 后的独立交付。它们只能读取已经发布且可执行的 Beta schema/catalog，不能在 PR #79 中预演一份与运行时不一致的契约。

### 1.3 PR #79 自身的合并门

- `git diff master...<PR79-head>` 只包含 `docs/` 和必要的根 `AGENTS.md` 权威指针；
- 设计规范、Host 生命周期、本手册和路线图互相引用，且不重复声明冲突的 API 语义；
- Stable catalog 只出现七项既定能力，manifest 无 runtime `form`；
- PR #77 的 Beta 门与 v1 Stable 门明确分开；
- PR #79 合并说明写明：**no runtime release, no npm release, no website/API availability claim**。

满足这些条件后可以合并 PR #79。合并动作不需要插件 runtime dogfood，因为它不改变用户可见行为；文档检查和 review 仍必须通过。

## 2. PR #77 当前判断

PR #77 已形成可保留的 implementation baseline：canonical UI/compiler、managed panes/overlays、additive status、status/editor provider runtime、editor extension runtime、split session facade、consumer lifetime fencing、legacy dock/view renderer 删除，以及独立 packed example suite。

`cf8b3bd` 已完成 current/previous Harness fixtures、四条 smoke、两个专用 profile 自动 dogfood和用户 live acceptance；`9a6a255` 只把该事实写回文档。这证明 W1-W6 候选可用，但不自动证明当前 public API 适合标 Stable。

合并前仍有五项安全或承诺问题：

1. API/host 宣称 `1.0.0`，但 schema、资源协商和生态证据尚未完成；
2. generic `session.act` 越过领域 action ownership；
3. 普通消费方可以订阅其他插件的全局通知；
4. owner helper 和 raw session/projection backing service 存在 sibling 绕过授权的路径；
5. editor/provider surface 被写成 Stable，而目标 v1 只冻结七项最小能力。

因此必须区分：

- **BETA-MERGE**：PR #77 阻止已知越权和错误 Stable 承诺进入 `master`；
- **PUBLIC-BETA**：版本化 schema/catalog/validator、product/protocol mapping 和至少一项外部可安装 capability 已实际发布；它不表示完整作者手册、skill 或 Stable 证据已经完成；
- **V1-RELEASE**：真实插件证据和所有发布门关闭后才发布协议 `1.0.0`。

## 3. Surface 裁决

| Surface | #77 当前事实 | 裁决 | Beta 合并要求 | v1 后续 |
| --- | --- | --- | --- | --- |
| canonical UI/compiler | `BlueUiNode`、builder、validator 和唯一 pi-tui compiler 已运行 | KEEP | 不恢复 legacy renderer；失败隔离 contribution | hostile node、2..120 width、public packed kit |
| `commands` | 真实 interaction bridge、abort、gesture、duplicate rollback、unload | KEEP | 标 Beta，保住生命周期证据 | negotiation、resource/limits、真实插件 consumer |
| `status` | additive node、revision、真实 owner/compiler | KEEP | 标 Beta；不能接管整个 footer | width/render failure/unload、真实插件 consumer |
| `panes` | managed placement、responsive layout、buffer/reload | KEEP | 使用 `panes`；保留最新注册，事件与 gesture 不排队 | narrow/focus/owner reload、真实插件 consumer |
| `overlays` | gesture、capturing quota、abort/close/focus restore | KEEP | overlay/gesture 不跨 owner 重载 replay | timeout/double-submit/hostile sibling |
| `notifications` | publish 与 subscribe 混在一个 consumer capability | CHANGE | public 只保留 `notifications.publish`；observe 仅供官方 owner | rate/dedupe/sink absence/unload |
| `session.read` | readonly current/subscribe seed，但 raw reader 可被 sibling inject | CHANGE | 保留 Beta seed；隐藏或保护 raw backing service，不宣称资源/epoch 已 Stable | fields grant、sessionEpoch、same-id new epoch |
| projection reader | 可按任意 key 读 `unknown`，raw service 可被 sibling inject | CHANGE | backing service 只供官方 owner；当前 public 形状不标 Stable | `session.projections.read` 精确 key grant、一致 cut、size bound |
| `session.act` | followup/steer/interrupt requester 与 fencing 已实现 | REMOVE public | 从 manifest、public root、README 和 website 移除；内部 dispatcher 可保留 | 领域写入继续走真实 action，不建立 generic replacement |
| status/editor provider | provider swap、LKG、breaker、fallback 已有完整 runtime | DEFER public | 只保留 bundle-internal/reference runtime，或明确 Experimental；不得占 Stable root | 真实消费者共创后另走 1.x 提案 |
| editor extensions | completion/submit/action、abort/stale/unload 已实现 | DEFER public | 只保留 bundle-internal/reference runtime，或明确 Experimental | 按最小授权拆分后另走 1.x 提案 |
| owner/control operations | root helper、aggregate/observe、gesture/close 存在绕过风险 | CHANGE | 普通 sibling 无支持路径可 self-attach、读取 aggregate、observe、mint 或 close | 具体 authority/generation 机制在内部规范与后续 PR 冻结 |
| manifest/docs/skills | flat capability list、inline manifest 和 Stable 1.0 表述 | CHANGE | 标 `1.0.0-beta.1`，删除错误稳定承诺和旧 capability 示例 | 单一 schema/catalog、required/optional/resources、持久包管线 |

## 4. PR #77 合并 runbook

### 4.1 同步设计基线

1. 合并 PR #79，记录其 merge commit。
2. 将 PR #77 更新到包含该 merge commit 的最新 `master`；rebase 或 merge 均可，但 PR body 必须记录新的 base 和 exact head。
3. 用本手册重新核对 PR #77 的 public exports、manifest、README、website、examples、release note 和 skills，不得只修改版本常量。
4. 保留 `cf8b3bd` 的 W1-W6 证据作为基线，不把它登记成新 head 的最终验收。

### 4.2 实施最小 Beta 安全门

PR #77 分支在合并前只完成以下工作：

1. 将 API/host version 改为 `1.0.0-beta.1`，同步 PR #77 自己涉及的 README、website、examples、release note 和 skills 的稳定性表述。
2. 从 public vocabulary 和 manifest 移除 generic `session.act`；内部 app dispatcher 不作为普通 Cordis service 暴露。
3. 将 notification consumer API 收窄为 publish-only；普通 sibling 不能观察其他插件通知。
4. 从 plugin-facing root 移除 owner attach、aggregate snapshot/observe、gesture mint 和 semantic close helper。
5. 隐藏或保护 raw session/projection reader/requester；普通 sibling 只能取得协商后的裁剪 facade。
6. 将 editor extension/provider 和 status provider 退出 Stable root，保留其成熟 runtime 与 reference tests。
7. 保持 canonical compiler、panes/overlays、additive status、provider/editor runtime、lifetime fencing 和 packed examples 不回退。

这里冻结的是可观察权限边界，不要求 PR #77 先实现名为 authority lease 的特定数据结构。内部实现可以使用 capability-scoped token、私有 closure 或 bundle-owned owner handle，只要满足 [Host 生命周期规范](./blue-plugin-host-lifecycle.md) 的行为和 hostile-sibling 证据。

### 4.3 形成新 exact head 的自动证据

Beta hardening 形成新的 exact runtime head 后必须：

- hostile sibling 无法 self-attach、读取 aggregate、observe 全局通知、mint gesture、关闭别人的 overlay或直接取得 raw session/projection truth；
- owner 短暂 reload 后 `commands`/`status`/`panes` 只恢复最新注册，overlay/gesture/action/notification/旧 callback 不 replay；
- unit、compile、coverage、typecheck、lint、build、check:lib、check:pack、examples、diagrams 和 website build 全绿；
- current/previous Harness packed fixture 的 declared scenarios 全执行且无 skip/failure；
- `smoke:happy`、必要的 PTY smoke 和 worktree profile 覆盖 120/80/40、pane/overlay、provider/editor reference runtime、theme/session swap、input/completion/submit；
- PR body 或 acceptance record 写明 exact commit、Blue API Beta version、两条 Harness line、profile、执行命令、fallback、unload/reload 和失败项。

### 4.4 真人验收、合并与清理

1. 用 PR #77 worktree 对应的 `blue-<tag>` profile 提示用户 live-test；不能指向共享生产 `blue` profile。
2. 等待用户对 **新的 exact head** 明确回复“验收通过”；自动测试不能替代这一步。
3. 验收后才合并 PR #77；合并说明必须写明这是 Beta foundation，不是 protocol v1 release。
4. 在主 checkout 重建合并后的 `lib/`，记录 merge commit 和 dogfood 结果。
5. 只有合并完成后才删除 `blue-<tag>` profile 和 worktree。
6. 不在该合并动作中发布 `1.0.0`、npm Stable tag 或正式插件开发手册。

## 5. Review PR #77 时如何理解内部术语

- **control-plane authority**：Blue 官方 owner 用来接管 capability、读取完整注册表、创建 gesture 或执行关闭等管理动作的内部权限。普通插件只能获得自己获准的数据和注册接口。
- **owner generation**：某个官方 owner 每次成功挂载的实例代号。owner 重载会产生新 generation，旧 handle 和旧异步结果必须失效。
- **owner gap**：capability 已由当前 composition 安装并允许使用，但负责消费它的 UI owner 尚未启动、正在重载或暂时失败。
- **registration restore**：gap 期间只保留普通插件“当前最新的定义”，新 owner 恢复后重新挂载这些定义。
- **replay**：把 gap 中发生的动作、通知、overlay、gesture 或旧回调补执行。此行为被禁止。

验收时只判断外部结果：`commands`、`status`、`panes` 的最新定义可以恢复；操作、通知、overlay、gesture 和旧结果绝不补执行。实现是否真的有一个叫 `authority lease` 的类型不是合并条件。

## 6. PR #77 之后的独立 PR 队列

后续工作必须在 `master` 上从 PR #77 的 merge commit 起步。每个编号表示交付批次，不预占实际 GitHub PR 号；同一批次内仍应按 capability 或工具边界拆小 PR。

| 批次 | 依赖 | 独立 PR 范围 | 退出门 | 此时仍不能宣称 |
| --- | --- | --- | --- | --- |
| P1 机器契约 | PR #77 merged | JSON Schema 2020-12、generated manifest type、semantic validator、immutable schema export、product/protocol mapping | positive/negative corpus；schema/runtime/CLI 同结论；packed files/exports 可见 | public Beta 可开发、任何 capability Stable |
| P2 Host 协商与权限 | P1 | required/optional/resource admission、exact grants、error taxonomy、受保护 control plane、generation/owner-gap 行为 | hostile sibling、partial grant、owner reload、declaration report 全绿 | 七项 capability 已有真实生态证据 |
| P3 UI capability Beta | P2 | 原则上分别收敛 `commands`、`status`、`panes`、`overlays`、`notifications.publish`；每个 PR 同步 owner、fallback、limits、fixture 和 reference | 每项独立 packed fixture、unload/reload、width/abort/stale 按适用场景全绿 | capability Stable；provider/editor 自动进入 v1 |
| P4 Session data Beta | P2 | `session.read` 与 `session.projections.read` 分开实施 fields/key grant、epoch/seq、一致 cut 和 size bound | same-id new epoch、replay/resume、key unload、stale/late result 全绿 | generic `session.act` 或 raw Session 可用 |
| P5 作者工具与文档 | P1/P2 完成，至少一个 P3/P4 capability 可运行 | 作者 `blue-plugin-development` skill、创造模式 prototype-to-local-package、任务式中英文 Website 开发手册、公开 validator/conformance 命令 | skill eval、教程 packed fixture、双语/链接/catalog drift、真实 profile 全绿 | protocol Stable；自动获准 GitHub/npm 发布 |
| P6 生态验证 | 对应 P3/P4 capability 可运行 | 六个首批项目各用独立 worktree/PR 或固定 conformance patch；维护者 outreach skill 可在本批次加入 | 固定 upstream commit、公开 Service/projection 边界、packed current/previous Harness、相同邀请标准 | 作者认可等于 conformance；已获得提交上游代码 PR 的授权 |
| P7 Stable 晋升 | P3-P6 对应证据完成 | 每项 capability 单独从 Beta 晋升 Stable；API root/declaration/docs/catalog 同步 | 真实 owner、官方/reference consumer、真实 Harness plugin、fallback、无 skip/failure、真人验收 | 其他 capability 同时 Stable |
| P8 dsh-market Beta 合作 | public Beta + 作者 skill + 至少两个 runnable integrations | metadata/spec 对齐、Blue-compatible 标识、profile 安装路径、双方文档互荐 | 合作范围有双方确认；不调用 private Web route | Blue 接管 market install/update，或合作本身关闭 v1 技术门 |
| P9 v1 发布 | 七项 P7 完成，P5/P6 总门关闭 | protocol `1.0.0`、对应 Blue `0.x`、创造模式、schema/API/mapping/migration notes 和干净安装验证 | 路线图 R6 全部门禁、最终 live acceptance、registry clean-profile smoke | 合并 commit 本身等于已发布 artifact |

并行规则：P3 的各 UI capability、P4 的两个 session capability、P5 的文档/skill/创造模式和 P6 的生态项目可以在依赖满足后并行；同一 PR 不得同时发明机器契约、扩 Stable catalog、迁移多个生态项目并发布 release。

## 7. 每个后续 PR 的共同模板

每个独立 PR 必须在 PR body 或对应 acceptance record 中写明：

- **Scope**：本 PR 唯一负责的 capability、工具或文档交付；
- **Authority**：消费方能做什么、官方 owner 才能做什么；
- **Fallback**：capability absent、owner gap、单 contribution 失败时的结果；
- **Lifecycle**：consumer unload、owner reload、session epoch、abort 和 late result；
- **Artifacts**：schema/API/package/website/skill 中实际发生变化的部分；
- **Evidence**：exact commit、tarball digest、Blue product/protocol/Harness versions、declared/executed/skipped/failures、profile 和人工验收；
- **Release claim**：只允许声称本 PR 真实关闭的 Beta/Stable/Release 状态。

状态必须依次记录为 `implemented -> automated green -> live accepted -> merged -> artifact published`。不得用前一个状态代替后一个状态，也不得把生态作者是否回复混入技术 conformance。

## 8. 归档条件

PR #77 合并后，本手册继续作为 P1-P9 的执行入口，并更新 PR #77 final merge commit。协议 `1.0.0` 和对应 artifacts 实际发布后，才把本手册移入 `docs/history/`；归档必须记录协议 tag、Blue product version、Harness lines、schema/API URL、最终 profile 和人工验收。
