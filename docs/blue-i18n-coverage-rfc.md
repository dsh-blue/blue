# Blue i18n 覆盖审计与插件 locale 提案

> 状态：Draft audit / proposal
> 审计基线：PR #77 head `614bb07845a3b0731264138d02b36e757f4ee9f0`
> 与 PR #79 的关系：增量后续提案；不修改 #79 的 Stable v1 capability 清单，也不修改 #77 的合并候选

本文记录 PR #78 的第一阶段 locale 行为在 PR #77 canonical UI runtime
上重做以后，默认产品面与公共插件路径仍存在的本地化缺口。本文只描述审计事实和
候选方案，不表示下述 surface 或公共契约已经落地；runtime 改动必须进入后续独立
PR。

## 1. 结论

第一阶段 locale 基础方向正确：

- `blueLocale` 属于 frontend tree scope；
- catalog 由展示文案的 package 持有；
- 英文是缺失 provider/catalog/key 时的回退；
- 已迁移的 command/help/settings consumer 可在 locale revision 后重投影。

剩余缺口有三个不同根因，不能只按“缺少几个字典项”处理：

1. command discovery 只有 interaction translator，却会接收 Blue、
   Harness preset 和第三方插件注册的 descriptor，且 descriptor 没有 owner
   namespace；
2. 多个只读面板打开时已经把英文 title/sections 固化，invalidate 只能重画同一批
   字符串；
3. public plugin host 没有 renderer-neutral 的 locale snapshot、resolve 和
   subscribe 契约。

后续顺序应固定为：先关闭用户反馈的浅层缺口，再根据运行时清单完成 Blue 自有产品
面的覆盖，最后用真实外部 consumer 验证 optional Experimental 插件 locale API。

## 2. 审计边界

审计对象是默认 Blue profile 中的可见文案，以及 public plugin contribution 的
展示路径。是否翻译由 ownership 决定，不能仅按字符串是否包含英文判断。

| 分类 | 处理策略 | 示例 |
|---|---|---|
| Blue UI chrome | 翻译 | heading、label、empty/loading、hint、footer action |
| 仅展示的语法占位 | 可翻译但不得改变解析 | `<question>`、`[name]`、`tokens` |
| runtime fact | 原样保留 | session id、cwd、model/provider 名、版本、数值 |
| 用户/model/tool 内容 | 原样保留 | prompt、模型输出、工具参数和结果 |
| 上游/第三方诊断 | 默认原样保留 | Harness error、plugin callback error |
| 历史发布内容 | 正文原样，frame 翻译 | changelog summary/highlight/known issue 正文 |

`packages/context` 是 validation-only package，不在默认 bundle 中。不能为了翻译
现有 interaction-owned `/context` fallback 而把它接入 bundle；只有它正式成为
bundled consumer 时，才单独审计其自有文案。

## 3. 审计发现

### 3.1 Command discovery 丢失文案 ownership

`BlueSessionCommand` 只有 `name`、`description`、`inputHint`。
`CommandModelService.list()` 把所有 description 交给 interaction catalog，
`editor-plus` 则独立拼接未经翻译的 input hint。该结构能覆盖已收录的 interaction
文案，但无法选择 transcript、Harness 或第三方 owner 的 catalog。

用户反馈的三个命令分别命中三类问题：

| Command | 注册 owner | 当前问题 |
|---|---|---|
| `/changelog` | Blue interaction | 英文 description 未进入 `INTERACTION_LOCALE` |
| `/btw` | Blue transcript | command discovery 看不到 transcript namespace，`<question>` 也保持原文 |
| `/compact` | Harness preset | 动态注册的英文 descriptor 没有 Blue 展示映射 |

这是 presentation 问题，不需要把 Agent、Session 或 Harness command registry 暴露
成新的公共 seam。短期兼容表应放在 interaction command presentation 层，并以精确
`(name, sourceDescription)` 为 key。上游 description 变化时必须回退源文本，不能
继续套用过期翻译。input hint 使用同一 exact-match 规则；执行仍收到原 command name
和 raw arguments。

未知第三方命令保持原文。Blue 不得根据 command name 猜测翻译，也不得翻译任意
plugin/user 文本。

审计 commit 上可静态确认的注册清单如下：

| 来源 | 可确认 descriptor | 当前 catalog 结果 |
|---|---|---|
| interaction slash command | 26 个 | 24 个已映射；缺 `/theme`、`/changelog` |
| transcript slash command | `/btw` | interaction command presentation 中缺失 |
| standard/code/cordis preset | `/plan`、`/compact` | 两个上游 description 均缺 interaction 映射 |
| interaction key batch | 14 条 help description | 第一阶段 interaction catalog 均未收录 |
| optional Blue key action | image paste、todo toggle | interaction catalog 未收录 |
| transcript detail toggle | 1 条 key action | 只存在于 transcript namespace，`/help` 不查询该 namespace |

26 个 interaction 注册是：`/quit`、`/new`、`/fork`、`/rewind`、
`/sessions`、`/help`、`/model`、`/effort`、`/provider`、`/yolo`、
`/status`、`/context`、`/version`、`/changelog`、`/export`、
`/copy`、`/init`、`/theme`、`/preset`、`/tools`、`/skills`、
`/mcp`、`/trace`、`/settings`、`/update`、`/plugin`。这是源码
inventory，不表示每个命令在所有 profile/session 状态下都 active。

Harness host row、user-invocable skill 和 public plugin contribution 还会在运行时
增加 descriptor。实现审计必须在 standard、code、cordis 三种 preset 下保存排序后
的 `(name, description, inputHint, sourceClass)` snapshot。动态 skill 与未知
plugin 文案保持原文；只有精确已知的 Harness descriptor 才进入 Blue 兼容表。

### 3.2 只读面板固化英文 presentation

`InfoPanelOptions` 当前保存具体 `title` 和 `sections` 数组。
`InfoPanel.currentNode()` 虽然会重建 canonical node，但数据源仍是打开面板时固化
的字符串。`/context`、`/status`、`/version`、`/changelog`、
`/tools`、`/mcp`、`/skills` 都使用该形态。

用户截图中的 `/context` 是 interaction-owned fallback，硬编码文案包括：

- `Session usage`、`Context window`、`Context usage (heuristic)`；
- `no provider usage recorded yet`、`no context window advertised`；
- `Estimated usage by category`、`System prompt`、`Tools`、
  `Messages`、`Free space`；
- usage bucket label、token unit、panel title 和 unavailable/error 文案。

`CanonicalDocumentController` 还提供 `loading...`、`no matches`、
`unavailable`、`no content` 等英文默认值。这些默认值归 interaction
composition 所有，不归 core；core 应继续只编译调用方给出的具体 canonical 字符串，
不能依赖 locale service。

替换契约应与已经动态化的 help overlay 对齐：

```ts
interface InfoPanelOptions {
  readonly title: string | (() => string)
  readonly sections: readonly InfoSection[] | (() => readonly InfoSection[])
  readonly t?: BlueTranslate
}
```

feature builder 保持 pure，并显式接收 `BlueTranslate`。打开的 panel 持有 locale
subscription；revision 后只 invalidate 同一 controller 并请求下一帧。不得替换
controller、focus、scroll window、selection、filter、form draft 或 editor
replacement handle。关闭或 feature unload 时先 dispose subscription，再恢复 editor。

### 3.3 产品面缺口不止截图

第一阶段已覆盖 settings、help、approval/question chrome、banner、transcript 基础
文案和部分 notice。机械扫描仍能确认以下 Blue-owned chrome：

| Owner | 后续 inventory |
|---|---|
| interaction session info | `/status`、`/context`、`/version`、`/changelog` |
| interaction feature panel | `/tools`、`/skills`、`/mcp`、`/trace`、model/provider/preset、update、plugin |
| interaction generic controller | loading、empty、filter、group、selection、footer 默认文案 |
| transcript pane | BTW、todo、agents、activity、status failure/fallback |
| command presentation | 默认 preset 的全部 command description 与 display hint |

P2 必须提交用于关闭该表的 runtime command snapshot。裸英文字符串数量不能作为验收
指标：它会把 model name、path、protocol id 和用户内容误判为 UI 文案，同时漏掉由
多个 fragment 拼出的 presentation。

### 3.4 Public plugin 没有 locale contract

当前 `BlueCapability` 与 `BluePluginApi` 提供 command、UI、notification、
provider 和 session facet，但没有 locale snapshot 或 subscription。插件只能硬编码
一种语言或自行探测 process state，无法跟随 Blue 持久化的
`locale.preference`，也无法一致地经历 locale provider replacement。

PR #79 只冻结七项 Stable v1 capability，并要求新 capability 先补齐 owner、
fallback、fixture 和真实 consumer 证据。因此 locale 只能在后续 PR 以 optional
Experimental capability 起步；本审计不修改 #79，也不声称它已经 Stable。

## 4. 分阶段提案

### P1：用户反馈的浅层缺口

PR #77 合入后创建一个小型 implementation PR：

- 为 `/btw`、`/changelog`、`/compact` 及仅展示的
  `<question>` hint 增加 exact presentation mapping；
- 翻译 `/context` title、section、label、unit、empty/error 和全部
  usage/composition 分支；
- `/changelog` 只翻译 `Highlights`、`Known issues`、`current` 等
  frame，历史 release note 正文保持原文；
- 增加已打开 `/context` 所需的动态 `InfoPanel` source 和 locale-bound
  invalidation；
- 未知 command 与上游执行结果保持原文。

P1 范围足够小，可尽快获得 live feedback；其动态 panel seam 供 P2 复用。

### P2：默认产品面全量覆盖

按 ownership inventory 逐个 feature family 迁移到 feature-owned catalog 和动态
presentation。因为 Harness descriptor wire 没有 locale namespace，interaction
catalog 继续作为默认 command registry 的统一展示兼容层；feature 私有 panel/body
文案仍由对应 package 持有。

completion、`/help` 和已经打开的 panel 必须响应同一个 locale revision，且不改变
controller/action identity。core 始终接收具体字符串，继续与 `blueLocale` 解耦。

### P3：Experimental plugin locale API

只有 P1/P2 的行为和术语获得反馈后，才新增 optional `locale.read`。候选
renderer-neutral contract：

```ts
export type BlueLocaleId = 'zh' | 'en'

export type BlueLocalizedText = string | Readonly<{
  en: string
  zh?: string
}>

export interface BlueLocaleSnapshot {
  readonly locale: BlueLocaleId
  readonly revision: number
}

export interface BlueLocaleReader {
  current(): BlueLocaleSnapshot
  resolve(
    text: BlueLocalizedText,
    values?: Readonly<Record<string, string | number>>,
  ): string
  subscribe(listener: (snapshot: BlueLocaleSnapshot) => void): BlueRegistration
}

export interface BluePresentationContext extends BlueLocaleSnapshot {
  resolve(
    text: BlueLocalizedText,
    values?: Readonly<Record<string, string | number>>,
  ): string
}
```

`string` 与 `BlueLocalizedText.en` 都是英文 fallback；
`BlueLocaleSnapshot` 只公开 effective locale 和 revision，不公开持久化 preference。
公共 locale 类型的唯一 owner 应迁到 `@dsh-blue/blue-api`；frontend runtime
import/re-export 这些类型，不能保留一套形状相近但独立的公开定义。

`BluePluginApi.locale` 只在 manifest 请求并获准 `locale.read` 时存在。command
label、pane/overlay title 等静态 presentation metadata 可接受
`BlueLocalizedText`；render callback 获得 `BluePresentationContext`，仍返回
当前 revision 下只含具体字符串的普通 `BlueUiNode`。现有零参数 callback 可忽略
新增 context，保持源码兼容。

API 不把每个 `BlueUiNode` 字符串扩成 dictionary，也不暴露
`BlueLocaleService`。plugin 自己持有 message object；frontend owner 负责 resolve，
并在 revision 后让已注册的 presentation callback 重投影。一次性 notification 与
command result 在产生时由 plugin resolve，不追溯改写已经发布的内容。

capability owner 是 `blueLocale` 与 `bluePluginHost` 之间独立、窄化的
frontend-tree bridge，显式排在两个 service 之后，不持有 renderer object。required
capability 缺失时 `open()` 原子失败；optional 缺失时不提供 facet。已经 grant 的
facade 遇到临时 owner/provider gap 时切到英文 fallback、推进 revision，provider
恢复后再次推进 revision 并恢复当前语言。consumer unload 会 dispose 全部
subscription，并永久 fence retained facade。

Experimental 之后的晋升至少需要一个 independently packed 第三方 consumer 和单独
设计裁决；它不属于 PR #79 冻结的七项 Stable capability。

## 5. 后续实现验证矩阵

### 5.1 内置 presentation

- `/btw`、`/changelog`、`/compact` 在 slash completion 和 `/help`
  中显示中文；切回英文后与源描述完全一致；
- `<question>` 只在 completion/ghost presentation 中本地化，raw invocation 和
  parsing 不变；
- 未知第三方 command、或 source description 已变化的上游 command 保持源文本；
- 打开的 completion、help overlay、context panel 在
  `zh -> en -> system` 时原地重投影，draft、focus、scroll、selection、action、
  controller identity 不变；
- `/context` 覆盖 usage 为零/非零、window 已知/未知、composition
  available/unavailable、projection loading/error/absent、display service absent；
- 中文 fixture 在全部 `SCAN_WIDTHS` 通过 adversarial width scan。

### 5.2 Public plugin contract

- manifest validator 区分 required、optional、unsupported、duplicate
  `locale.read`，且不把它加入 Stable root；
- 覆盖 current snapshot、interpolation、英文 fallback、revision monotonicity、
  provider gap/reload、consumer unload、retained-facade fencing；
- 一个 packed example plugin 只使用 published API 提供本地化 command、pane、
  overlay，支持 live switch，并在当前/上一 Harness line 独立安装；
- owner unload 后 subscription 被移除，late callback 不能刷新 dead contribution；
- package exports/files/tsdown、bundle composition、validator、independent fixture、
  public API declaration report 保持一致。

每个用户可见 implementation PR 还必须通过 repository test、coverage、typecheck、
lint、build、lib/package、website、smoke 和相关 plugin fixture，并在自己的 profile
得到 live acceptance 后才可合并。PR #77 的既有验收不能覆盖这些新增行为。

## 6. 本提案 PR 的边界

本审计 PR 只修改文档，不会：

- 修改 PR #77 或 PR #79；
- 编辑 runtime package、manifest、preset、bundle row、test 或 release artifact；
- merge 或关闭 PR #72、#77、#78；
- 修改生产 `blue` profile，或删除现有 acceptance profile；
- 在本提案通过评审前授权 P1、P2、P3 的实现。
