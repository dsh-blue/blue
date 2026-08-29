# `@dsh-blue/blue-core`

[English](README.md) | 中文

Blue 终端 UI 核心：整棵树中唯一 import `@earendil-works/pi-tui` 的包。加载该插件先探测终端背景色（OSC 11，在 raw mode 之前），随即启动终端（`ProcessTerminal` 之上的备用屏 `TuiAltScreen` 渲染器：raw mode、bracketed paste、Kitty 键盘协议协商、应用内滚动与文本选择），并注册 L1 服务；卸载插件会恢复主屏，并把最终会话写回终端原生 scrollback。本包不 import 任何 harness 包——只依赖 pi-tui 与 Cordis。

## L1 服务

`src/types.ts` 中的 L1 契约是自有的最窄接口：其中不出现任何 pi-tui 类型、harness 业务类型或具体渲染器类；L0（`src/terminal.ts`）在内部委托给 pi-tui。

- `ctx.blueScreen`（`BlueScreen`）——组件挂载。`addChild` 返回 disposer，`showOverlay` 返回含 focus/unfocus 的句柄，`setFocus` 持有唯一焦点槽位，`requestRender` 调度节流重绘，`columns` 报告终端宽度。`BlueComponent` 与 pi-tui 的 `Component` 结构兼容但类型独立。
- `ctx.blueTheme`（`BlueTheme`）——语义色表契约。每个值都是 `(text: string) => string` 的 ANSI 包装函数，覆盖 `BlueSemanticColors` 集合——31 个标量 token 加横幅逐行扫色的 `logoGradient`（全部 required；v2 新增 `primary`——交互主色：选中、链接、spinner、运行指示——与 `textMuted`——最暗灰阶层：计数器、按键行、截断行）。契约留在本包 `src/types.ts`；实现以六个子路径插件发布，主题 provider 换装无需消费者改动：`./theme-dark`（`blue-theme-dark`，内置暗色调色板，plain 基线默认，导出 `DARK_COLORS`）、`./theme-light`（`blue-theme-light`，内置亮色调色板，导出 `LIGHT_COLORS`）、`./theme-ocean`（`blue-theme-ocean`，内置蓝调暗色调色板）、`./theme-paper`（`blue-theme-paper`，内置暖色亮色调色板）、`./theme-auto`（`blue-theme-auto`，inject `blueTerminalInfo`，按探测到的终端背景选 dark/light，并在 `'blue/terminal-theme-changed'` 事件时换装 palette——连续换装经 promise 链序列化）与 `./theme-custom`（`blue-theme-custom`，JSON 文件把 token 名映射到 `#rrggbb`，叠加在内置 base 调色板之上；Config 经 `@deepseek-ai/schemastery` 校验，非法条目警告后回退 base 条目，文件不可读时整体回退 base 调色板）。六者都构建在内部模块 `src/theme-palette.ts` 之上：hex→ANSI 助手、`colorsFromForegrounds` 冻结色表构建器与 `defineThemeService` Service 子类工厂。
- `ctx.blueKeymap`（`BlueKeymap`）——键位注册表，分语境与全局两半。`register(actions)` 先整批校验（重复 id、键位已被其它动作占用）再提交，并返回 disposer；`matches(data, action)` 测试输入序列；`getKeys(action)` 解析已绑定键位。携带可选 `handler` 的动作是焦点无关的全局动作；不带 handler 的是语境动作，由组件经 `matches` 解析。`dispatch(data)` 运行全局半边：带 handler 的动作按注册序触发，并回报是否有 handler 消费了输入。本插件的 `apply` 自行接线全局半边——一个装在焦点路由之前的 pi-tui input listener 消费 `dispatch` 认领的输入——并直接实例化该服务（`new BlueKeymapService(ctx)`）而非经 `ctx.plugin`，因为 Cordis `Context` 代理会拒绝对未 inject 服务的访问，而服务无法 inject 自身。
- `ctx.blueTerminalInfo`（`BlueTerminalInfo`）——只读终端事实：`background`（`'dark' | 'light' | undefined`，来自启动时的 OSC 11 探测）与 `kittyKeyboard`（Kitty 键盘协议是否协商成功）。此后的 DEC 主题上报会发出 `'blue/terminal-theme-changed'` 事件（`'dark' | 'light'`）。
- `ctx.blueComponents`（`BlueComponents`）——组件工厂。`createEditor` / `createMarkdown` / `createSelectList` / `createSettingsList` 在 pi-tui 无关的接口背后构建 pi-tui 支撑的组件，并把当前 `blueTheme` 色表映射到 pi-tui theme（markdown 映射为 S10 的 v2 版：标题经粗体承载层级、无序列表符归一为 `•`、代码围栏经 `highlightCode` 钩子由 cli-highlight 着色——未知语言回退纯文本，着色不改变行数；S17 dogfood 给 markdown 适配器补上分割线后处理：pi-tui 把规则硬顶在 80 列，适配器按主题已知输出的精确串匹配、容忍行 padding，重绘为满渲染宽——码块行因自带 SGR 不误伤）；编辑器 theme 的默认边框为中性 `border` token，斜杠/bash 语境经 `setBorderColor` 变色；`visibleWidth` / `wrapText` / `truncateToWidth` 是共享的宽度纯函数，S14 起另有模糊匹配对——`fuzzyMatch(query, text)`（pi-tui 的 subsequence 匹配器，`{matches, score}` 低分优先）与 `fuzzyFilter(items, query, getText)`——经契约重导出供各补全面消费。此处构建的编辑器同时持有 S14 下拉处理：`/` 前缀的补全菜单经内部 `WrappingSelectList` 渲染（本仓唯一的 pi-tui 子类——描述至多换行 2 行），其余补全走原版列表；`setGhostHint(text | undefined)`（首个消费者）驱动 chrome 层拼接的参数幽灵提示。工厂还提供 `createImage(options)`（返回 `BlueImage`，即 `BlueComponent` 别名，包装 pi-tui 的 Image；无图像协议的终端回退为带样式的文本）与 `imageDimensions(data)`（对 PNG/JPEG/GIF/WebP 字节的纯尺寸探针，无法识别时返回 `undefined`）。`BlueEditor` 契约还暴露 `setAutocompleteProvider(BlueAutocompleteProvider)`——类型独立的 `BlueAutocompleteItem` / `BlueAutocompleteSuggestions` / `BlueAutocompleteProvider` 三件套，由 L0 适配器原样透传给底层渲染器——以及 `getExpandedText()`，提交时用它把粘贴标记展开为完整内容。`BlueEditor` 还带前置拦截钩子 `onKey?(data)`——在 pi-tui Editor 处理输入序列之前调用，返回 `true` 即消费该序列（编辑器语境键链放在这里，因为 pi-tui Editor 吞掉 Ctrl-C 且自身没有兜底出口）——`isShowingAutocomplete()`，以及 `insertText(text)`——光标处原子插入，供剪贴板图片标记使用。S11 起编辑器渲染为圆角框：适配器经共享 chrome 辅助层对每次 render 后处理（`setPromptSymbol('>' | '!' | undefined)` 在首个内容行叠提示符——bash 的 `!` 随边框色、中性的 `>` 保持默认前景色；`setBorderLabel(text)` 把已着色文本嵌入顶边框、绝不进入滚动指示行；`setConnectedAbove(bool)` 把顶角切为 `├┤` 以衔接上方面板），角与侧条经**活**边框色重涂，宿主换色全程同步。工厂 inject `blueTheme`，provider 换装会经 Cordis reload 语义重建工厂。

  `BlueEditor.setSubmitBarrier(callback)` 会在原生 editor 清除 buffer、paste table、undo 状态与 history cursor 之前暂停提交。每个冻结的 attempt 都带展开后的文本、abort signal、单调 revision 以及幂等 `commit`/`cancel`；buffer mutation、新 attempt 或 barrier 换装会中止旧 attempt。`submit()` 让程序化提交经过同一屏障。

## 共享 chrome 辅助层

框架表面算法保留在 core 私有的 `src/chrome.ts`，不再提供公共 `./chrome` 子路径。Core 在内部使用这些主题无关 helper 处理 editor 边框、提示符、gutter、补全提示和 ANSI 安全截断。Renderer adapter 的通用宽度操作只调用 `BlueComponents.visibleWidth`、`wrapText` 与 `truncateToWidth`；连接 pane 的顶边框仅通过窄化的 `BlueComponents.topRule(width, options)` 操作暴露。终端宽度和 ANSI 组合因此始终留在 core 内部，不形成第二套渲染 API。

五个契约都以 Cordis `Service` 子类挂载（`blueTheme` 由主题子路径插件挂载，其余由本插件的 `apply` 挂载）；插件 fiber 卸载时各自自动摘除。组件只消费这些接口，绝不接触 pi-tui 类型。

## 公共 UI 校验与编译

`validateBlueUiNode`、`validateBlueStatusNode` 与 `validateBlueEditorShellNode` 是 renderer-neutral 公共树的准入边界。它们只复制已知字段，剥除终端控制字符串（包括 ESC 与 C1 两种 CSI/OSC/DCS/SOS/PM/APC 形式），递归冻结 canonical 副本但不冻结调用方对象，并返回稳定的 `BlueResult`。单棵树上限为 20,000 个 UTF-16 source unit、深度 8、256 个节点、每个 collection 200 项。Status 树递归限制为非交互节点。Editor shell 必须恰有一个宿主持有的 `editor-control`，且它只能出现在 editor 根、stack child 或 surface child/footer；scroll 等普通 UI 后代不能重新开放该 slot。若 `when`、`maxSize: 0` 或显式零空间 stack 路径可能隐藏 editor，该 shell 会在准入时被拒绝。嵌套公共 `scroll` 会被拒绝。

`compileBlueUiNode(value, { components, colors, getViewport, screenMode, emit })` 必定先经过上述 validator，再返回 canonical node、pi-tui 支撑的 component，以及至多一个 composite focus target。该 composite 独占 roving focus、实时响应式可见性协调和 event/render 异常隔离；单个控件不会作为 focusable 泄漏。公共文本无法注入 pi-tui cursor marker 或 core 私有 focus sentinel。Component 会暴露真实的 pi-tui layout node，使嵌套 stack/scroll 获得实际分配高度。Direct render（包括 AltScreen stop replay）使用私有 sentinel，在完整合成后替换；AltScreen layout pass 中 pi-tui 会刻意绕过 wrapper `render`，因此 active leaf 在 composite focus 协调后使用等宽 cursor-marker adapter。两条路径均保证聚焦时恰好一个 marker、失焦时没有 marker，并由真实 layout-frame 测试锁定 HStack 文本完整性。

Canonical `chrome: 'overlay'` surface 由 core 统一绘制单一闭合边框。左右边框与显式内距只扣减一次，窄标题仍保留右上角；终端缩放经过 1/2 列时，边框会让位给宽度安全的 body 内容；overlay 内容只贡献 body，不再重复绘制 frame。

`compileBlueEditorShellNode(value, { editor, ...compilerOptions })` 独立校验 editor-shell 子集，并围绕调用方提供的同一个宿主持有 `BlueEditor` 对象编译唯一 `editor-control`。因此 shell 刷新不会丢失 renderer 的光标、IME、粘贴、undo 或 history 状态；返回的 composite 仍是唯一 focus target，在该 editor 与同级 canonical 控件之间路由输入。新增的 `renderChecked(width, { dryRun })` 会结构化报告已收容的 `runtimeFailure`；dry run 在测量 provider candidate 后恢复 editor 与 composite focus 状态。`focusEditor()` 只选择内部 editor-control，不会获取 screen focus。

`compileBlueStatusNode` 使用收窄后的 status validator，并返回被动的 1-3 行 component。每次 `renderStatus` 都报告 overflow；若 leaf 或 root 在正常的安全错误渲染背后失败，还会报告该帧首个 `runtimeFailure`。Renderer owner 因此能拒绝失败的 dry render 或执行 fallback，而异常不会逃出 compiler boundary。

AltScreen 中，公共 scroll 编译为非 primary、overscroll contained 的 `ScrollView`；`follow: 'end'` 跟随尾部，`'start'` 与 `'none'` 从顶部开始，由 pi-tui 按 stack 实际分配的 pane 高度裁剪。MainScreen 中 scroll 展开为原生线性输出，row stack 降级为纵向文档顺序，而且不按 viewport rows 截断，从而保留完整终端 scrollback。Layout pass 的响应式条件使用 layout engine 的实际 frame 尺寸，direct render 使用实时 pane viewport；焦点协调使用实时 pane snapshot。Stack sizing 只采用与 viewport 无关的 1,000,000 安全上限，因此 resize 后可重新分配到 compile 时尺寸以外的空间。

## 终端生命周期

`createTerminalRelease()` 返回供 `@deepseek-ai/dsh-app-boot` 的 `installFailLoud(binName, proc, release)` 使用的 `release` 函数：发生致命加载失败时，它停止当前活跃的终端栈（先 drain 未决输入），使进程退出前恢复 raw mode 与 bracketed paste。没有活跃 Blue 终端时它是 no-op。各服务经由稳定的代理引用委托，未来切换渲染器（主屏/alt-screen）无需消费者改动。

备用屏处于活动状态时，Host 代码对 stdout/stderr 的直写仍会到达终端，随后触发一次强制全帧重绘，避免动态插件日志及其它绕过 renderer 的输出残留在编辑器或 footer 内。终端 suspend 期间与 stop 之后会解除该 guard。

应用内拖选在直连终端中通过原生 OSC 52 复制；在 tmux 内则执行 `tmux load-buffer -w -`，同时更新 tmux paste buffer，并由 tmux 向外层剪贴板转发。该路径兼容 `set-clipboard external`（它会明确忽略应用发出的 OSC 52），也不依赖默认关闭的 DCS `allow-passthrough`。出现 `Copied!` 表示 tmux 命令已成功退出；外层终端仍须通过 tmux 的 `Ms` 能力声明剪贴板支持。

## 模型体验

无影响，因为终端 UI 核心面向用户渲染，不注册任何模型可见的内容。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **崩溃日志目录沿用 pi 默认值**——渲染器把行宽溢出崩溃日志写到 `~/.pi/agent`（或 `PI_CODING_AGENT_DIR`），因为 pi-tui 硬编码了该默认值，而 Blue 尚无可传入的 dsh 侧路径。
- **公共 UI 的 Host 接线仍暂缓**——本包现已持有准入和编译边界，但 registry/host 接线及应用迁移仍归 W2-C/W3。
- **键位冲突检测范围**——冲突检测只覆盖经 `ctx.blueKeymap` 注册的动作；pi-tui 组件（Editor、SelectList）从 pi-tui 的全局键位表解析各自绑定，本包不动该表。
