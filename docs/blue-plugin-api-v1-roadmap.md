# Blue 插件 API v1 发布路线

> 状态：**Active roadmap**
> 起点：PR #77 按最小 Beta 安全门合并
> 终点：插件协议 `1.0.0`、对应 Blue `0.x`、创造模式、开发手册和生态验证共同发布
> API 语义：[设计规范](./blue-plugin-contract-v1.md)
> 合并与独立 PR 顺序：[PR #79 / PR #77 合并手册](./blue-pr77-convergence-matrix.md)

本文只定义阶段、并行工作流、交付物和退出门。每个实际 PR 的范围、顺序和 acceptance record 以合并手册为准。项目名单不表达规模、地位、流量或合作优先级；每个生态项目使用同一套技术与沟通标准。

## 1. 完成定义

协议 v1 不是只修改 `BLUE_API_VERSION`。发布必须同时具备：

- JSON Schema Draft 2020-12、generated TypeScript、共享 runtime/semantic validator；
- 七项 Stable capability 的 public API、resource grant、真实 owner 与 fallback；
- plugin-facing data plane 与内部 management authority 的权限隔离；
- product version -> protocol version 的机器映射；
- 独立 `npm pack` conformance kit 和真实 Harness 插件 fixture；
- 可生成并验证本地持久包的创造模式；
- 维护者 outreach skill 与作者 `blue-plugin-development` skill；
- website 中按任务递进的中英文开发手册；
- 当前/上一 Harness line、真实 profile 和人工验收证据。

主线顺序：

```text
PR #79 设计基线
  -> PR77 Beta 安全合并
  -> 最小七能力 Beta schema/API
  -> 生态验证 + 创造模式 + skills + 开发手册（并行）
  -> 按真实使用证据晋升 Stable
  -> dsh-market Beta 合作
  -> protocol 1.0.0 + Blue 0.x + 创造模式发布
```

Fixture 与 capability 同步建设，不在实现结束后补测试。作者联系与技术 conformance 是两条独立记录。

执行批次与路线阶段的对应关系固定为：

| 路线阶段 | 合并手册批次 | 含义 |
| --- | --- | --- |
| R0 | PR #79 | 只合并 Draft 设计与控制文档 |
| R1 | PR #77 | 只合并 Beta runtime foundation |
| R2 | P1-P4 | 机器契约、Host 协商、UI 与 session capability Beta |
| R3 | P5-P6 | 作者工具/文档、创造模式与生态验证 |
| R4 | P7 | 按 capability 独立晋升 Stable |
| R5 | P8 | dsh-market Beta 合作 |
| R6 | P9 | 协议 `1.0.0` 与对应 artifacts 发布 |

## 2. R0：PR #79 设计基线

> 状态：**完成**。PR #79 以 merge commit `7f3d13ab80932dc6bb778c359328c582d3767eae` 合入；没有 runtime、npm 或 Website API availability 发布。

### 产物

- API v1 设计规范：机器契约与 Stable 边界。
- Host 生命周期规范：内部权限、generation 和重载行为。
- PR #79 / PR #77 合并手册：发布边界、Beta merge control 和后续独立 PR 队列。
- 本路线图：阶段与退出门。
- `docs/README.md` 与根 `AGENTS.md` 的权威指针。

### 发布边界

R0 只把 Draft/Active 文档和必要的根 `AGENTS.md` 指针合入 `master`。它不修改 runtime、package/API version、website、创造模式、skill、schema、validator、example 或 bundle，也不发布 npm、Pages 上的可用性承诺或任何外部邀请。完整边界和 PR #79 自身检查见[合并手册“PR #79 的发布边界”](./blue-pr77-convergence-matrix.md)。

### 退出门

- Stable 只包含 `commands`、`status`、`panes`、`overlays`、`notifications.publish`、`session.read`、`session.projections.read`。
- manifest 没有 `form`；架构职责和迁移模式不成为运行时分类。
- 公开术语与 Harness 对齐，内部 control-plane 术语不进入 quickstart。
- PR77 只承担最小 Beta 安全门，不被迫实现全部 v1。
- 生态项目不按规模、下载量、地位或响应概率分层。
- PR #79 diff 不包含 `website/`、packages、presets、skills 或 runtime artifacts。

## 3. R1：PR #77 Beta foundation

> 状态：**完成**。最终验收 head `c2f9f26ad026d76a47d1f6679a04013937d0e977` 以 merge commit `f185834293fe6c16eac29aff489224bc0af8c9fd` 合入，merge tree 与验收 head 相同。

截至初始审计对象 `9a6a255`，#77 的 W1-W6 运行候选 `cf8b3bd` 已完成自动证据和用户验收。R1 在该基础上只关闭已知越权和错误 Stable 承诺：

1. API/host version 改为 `1.0.0-beta.1`，同步 README、website、examples、release note 和 skills。
2. 移除 public generic `session.act`；内部 dispatcher 不成为普通 sibling service。
3. notification consumer 只保留 publish；observe 属官方 owner。
4. owner attach/aggregate/gesture/close helper 退出 plugin-facing root。
5. raw session/projection backing service不可由普通 sibling直接取得。
6. editor/status provider 与 editor extension 保留 reference runtime，但退出 Stable root。
7. 保留 canonical compiler、managed panes/overlays、status、provider/editor runtime、lifetime fencing 和 packed suite。

R1 只冻结可观察权限结果，不强制特定 authority representation。hardening 后的 exact head 已重跑双 Harness fixture、四条 smoke、`blue-pr77-beta` worktree profile 和真人回归；完整记录见[合并手册 4.4](./blue-pr77-convergence-matrix.md#44-真人验收合并与清理)。R1 合并不等于 v1 发布，P1-P9 尚未启动。

## 4. R2：最小 Beta 机器契约与 capability

R2 按合并手册拆为 P1-P4，不得放进一个大 PR：P1 建机器真相，P2 建协商与权限，P3/P4 才把 UI 和 session capability 接到该契约。

当前进度（本地状态，不代表远端或发布 artifact）：P1 以 `a13e6e8`、`f2222c2`
完成机器契约、共享 corpus、packed validator 与双 Harness line fixture；P2 以
`522d2ca`、`96e8999` 完成 canonical host admission、required/optional、精确
resource grant、结构化 denial、受保护 owner generation 与 durable registration
restore。两阶段均已由用户真人验收并合入本地 `master`，但尚未 push，也没有发布
npm、Website 或协议 artifact。`session.projections.read` 仍保持 unavailable，等待 P4。
P3 是独立候选 worktree，P4 尚未进入本地 `master`；两者都不能被当作 capability
Stable 证据。

P3 候选 worktree 已把五项 UI capability 接到 canonical grant：resource/数量/刷新/
notification 大小与速率限制、owner-gap restore、command/事件 stale fence、overlay
不重放和 status failure isolation 已进入自动测试；整树门禁、独立 packed fixture 与
真人 profile 验收完成前仍只记为 implemented candidate。

### Schema 与 package

- `package.json.blue.manifest` 是唯一 discovery pointer。
- `blue.plugin.json` 包含 identity、public exports entry、API/product compatibility、required/optional capability 与判别式 resources，不含 `form`。
- schema 使用 Draft 2020-12 和 `additionalProperties: false`。
- generated manifest type 不手改；semver 使用正式实现，不用正则近似。
- runtime parser、CLI validator、installer 和 website examples 共用同一 corpus。
- validator 检查 id=package name、entry=exports subpath、`files`、tarball 和 peer closure。

### Catalog 与 host

- generated capability-name union只含七项 Stable；Beta/Experimental 不进入 Stable root。
- catalog记录 version、resource schema、owner、scope、limits、registration restore 和 unavailable fallback。
- required 原子准入；optional 可缺失或获得 resource 子集；host 返回 exact grants。
- API declaration report阻止 owner-only、Deferred 或 raw backing types 泄漏。
- 发布 immutable schema/API subpath 和 product/protocol mapping。

### Capability Beta

- `commands`、`status`、`panes`、`overlays`、`notifications.publish` 原则上逐项 PR 接入 grant、limits、fallback 和 owner lifecycle。
- `session.read` 与 `session.projections.read` 分开 PR 收敛 fields/key grant、session epoch、seq、一致 cut 和 size bound。
- provider、editor、conversation、theme/settings 和 market operation 不因 PR #77 已有 runtime 自动进入 v1 root。

### 退出门

- positive/negative corpus覆盖 identity、entry、semver、required/optional、resource、unknown field和重复 capability。
- schema、generated TS、runtime、validator、installer、templates和website无漂移。
- workspace 外包可直接运行 validator 和 packed fixture，不要求 clone Blue。
- 每个已开放 Beta capability 有真实 owner、plain fallback 和适用的 unload/reload/width/abort/replay/stale fixture；未完成的 capability 保持 unavailable，不能伪装 grant。

## 5. R3：并行真实反馈

P1/P2 完成且至少一个 P3/P4 capability 形成可运行 Public Beta 后，按 capability 同时开启四条工作流；不能先冻结宽 API 再等待末期验证。作者手册和 skill 只能描述当时机器 catalog 实际开放的能力。

### 5.1 生态验证与协作

当前实施批次的三个项目采用同一标准：固定 upstream commit、记录公开边界、只使用 v1 候选七项中当时已开放的 Beta capability、独立 packed fixture、相同邀请 Issue 模板和相同作者 skill 链接。

| 项目 | 当前公开边界 | Blue v1 验证切片 | 技术前置条件 |
| --- | --- | --- | --- |
| [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | headless tools、持久团队状态、scheduler、command、Web 私有 routes/internals | `commands`、`status`、`panes`、`overlays` | 先由上游拥有 renderer-neutral Service Definition 或 session projection；不得读 `.agent-teams`、private route 或 package internal |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | `contextTimeline` / `contextHeaders` session projections 与公开 types | `session.projections.read`、`commands`、`status`、`panes`、`overlays` | 保持 Host projection 为唯一真相，Blue entry 不复制 Web dashboard state |
| [TokenLedger](https://github.com/zh667/TokenLedger/issues/57) | 跨 session 账本、usage/configuration/action；现有 Web/Host face 保持不变，窄化 `tokenLedgerV1` Service 仍是本地候选 | `commands`、`status`、`panes`、`overlays`、`notifications.publish`；需要当前会话语境时才选配 `session.read(identity)` | Blue companion 直接 inject renderer-neutral Service；跨 session 账本不得伪装成 `session.projections.read`，不得暴露 SQLite、凭据、Agent/Session 或 renderer object |

`dsh-cost-meter` 与 TokenLedger 的 token/费用聚合、历史、模型/站点、余额/额度、导出和设置高度重叠，因此从当前 goal 暂停；它独有的实时单-session cost、预算/峰谷提醒与更广定价矩阵保留为后续 gap backlog，不并行维护第二套计费 surface。

每个项目的 fixture MAY 位于固定 fork或 conformance workspace，但必须记录 upstream commit、patch、同步/删除条件和代码 ownership。Blue 默认只发邀请 Issue，不向上游提交未经邀请的代码 PR。作者认可与互荐是生态目标，但不作为确定性 v1 release gate。

### 5.2 创造模式

保留现有 inspect、define、run、update、stop、rollback 和隔离 runtime；新增持久包闭环：

```text
需求与 zero-API 判断
  -> inspect + 临时 capability request
  -> 会话内原型
  -> 用户验收
  -> 明确选择 ephemeral / local / GitHub / npm
  -> 生成 package + blue.plugin.json
  -> shared validator
  -> npm pack
  -> current/previous Harness 独立安装 fixture
```

确认前不得生成持久 package、repository、commit、tag 或 release。v1 的确定性硬门止于本地持久包和双线 fixture；GitHub/npm 真实发布、凭据与 2FA 只在用户明确确认后执行。

### 5.3 两类 skills

- `blue-ecosystem-outreach` 仅供 Blue 维护者：审计公开边界、生成内部可行性骨架和机器证据、输出邀请 Issue 草案；实际发 Issue 前再次确认；默认不生成上游代码 PR。
- `blue-plugin-development` 是作者唯一入口：支持新插件和现有 Harness 插件增加同包 Blue frontend entry，生成 manifest/entry/fallback/fixture，遇到缺失 Stable capability时停止并输出提案。

作者 skill 只维护一份，位于 Blue 仓库创造模式 preset；标准模式不加载。邀请 Issue 直接链接 GitHub 中这份 skill。两类 skill都读取发布的 schema/catalog，不复制 capability 名单。

### 5.4 Website 开发手册

中文源、英文镜像按任务递进：开始开发、选择接入路径、架构术语、包与 manifest、UI capability、session 数据、生命周期、Web 迁移、创造模式、验证发布、案例、API reference。教程样例自身进入 packed fixture；website build、链接、双语结构和 schema/catalog drift进入 CI。

## 6. R4：Stable 晋升

七项 capability逐项晋升，不以“代码已经存在”代替证据。每项必须具备：

- 真实 owner 与官方/reference consumer；
- 至少一个真实 Harness 插件 consumer；
- capability absence/plain fallback；
- renderer contribution 的 width/failure isolation，read 的 replay/resume/stale，action 的 gesture/abort/stale，按适用场景齐全；
- 当前/上一 Harness line的独立 packed fixture，`declared == executed`、`skipped == []`、`failures == []`；
- package/bundle composition、unload/reload、late callback和真实 profile验收；
- 作者手册、skill、API declaration和机器 catalog一致。

provider、conversation、theme/settings、editor 等不因已有 #77 runtime 自动晋升；它们继续作为内部/reference 或 Experimental 候选，在后续 1.x 以真实消费者共创。

## 7. R5：dsh-market Beta 合作

联系时机：公开 Beta、作者 skill和至少两个可运行生态验证项目就绪后。

v1 合作范围：

- Blue frontend entry metadata；
- Blue-compatible badge/filter；
- `blue` profile 安装路径；
- 与 dsh-market metadata/specification system 对齐；
- 双方文档互荐与 TUI 定位说明。

dsh-market 当前 Web HTTP routes 和 beta Update API 不被包装成完整市场 Service。Blue 不调用 private route、不复制 pnpm/profile/restart逻辑，也不定义 `market.install` capability。完整 catalog/search/install/update/uninstall/rollback TUI 等 dsh-market 提供 typed、versioned、renderer-neutral Cordis Service 后另行设计。

## 8. R6：`1.0.0` 发布门

按以下顺序关闭：

1. schema、generated TS、runtime validator、installer、catalog和version mapping green；
2. 七项 Stable capability逐项证据完整，Stable root无 Experimental/owner power；
3. 六项目矩阵的适用技术切片都有明确状态，发布证据覆盖七项能力；外部作者响应不作为硬门；
4. 创造模式完成 prototype -> accept -> local package -> validator -> `npm pack` -> 双 Harness独立安装；
5. 两类 skill eval和中英文开发手册 green；
6. full repository gates、website、packed install和真实 profile smoke green；
7. worktree profile覆盖 install、unload/reload、session swap、120/80/40和生态验证切片；
8. 用户 live-test并明确验收；
9. API/host从 `1.0.0-beta.*` 晋升 `1.0.0`，发布 immutable schema/API、mapping和migration notes；
10. 从 registry新建干净 profile做最终 install smoke并记录 exact artifacts。

任何 Stable capability缺真实 owner/consumer/fallback、任何适用 fixture skip、private Web route被当公开 API、创造模式不能生成并验证本地持久包、上一 Harness line或人工验收缺失，都阻止 `1.0.0`。Blue 产品版本仍可保持 `0.x`。

## 9. 工作方式

- 每个阶段使用独立 worktree和小 PR；不把 v1 roadmap全部塞回 #77。具体拆分使用合并手册的 P1-P9 队列。
- capability PR同步修改 code、tests、package AGENTS、bundle composition、fixture和当前实现文档。
- API 设计变化先评审设计规范；实现进度只更新矩阵/roadmap。
- Website 正式开发手册、作者 skill 和创造模式持久化只能在对应 Beta schema/catalog/validator 可运行后进入 P5，不能回填 PR #79。
- 用户可见行为必须走 worktree profile和真人验收，验收前不合并、不删除 profile。
- 技术 conformance、作者联系状态和市场合作状态使用不同字段，不互相冒充完成。
