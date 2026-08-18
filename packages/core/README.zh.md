# `@deepseek-ai/dsh-blue-core`

[English](README.md) | 中文

Blue 终端 UI 核心：整棵树中唯一 import `@earendil-works/pi-tui` 的包。加载该插件先探测终端背景色（OSC 11，在 raw mode 之前），随即启动终端（`ProcessTerminal` 之上的主屏 `TuiMainScreen` 渲染器：raw mode、bracketed paste、Kitty 键盘协议协商），并注册 L1 服务；卸载插件即停止终端并恢复终端状态。本包不 import 任何 harness 包——只依赖 pi-tui 与 Cordis。

## L1 服务

`src/types.ts` 中的 L1 契约是自有的最窄接口：其中不出现任何 pi-tui 类型、harness 业务类型或具体渲染器类；L0（`src/terminal.ts`）在内部委托给 pi-tui。

- `ctx.blueScreen`（`BlueScreen`）——组件挂载。`addChild` 返回 disposer，`showOverlay` 返回含 focus/unfocus 的句柄，`setFocus` 持有唯一焦点槽位，`requestRender` 调度节流重绘，`columns` 报告终端宽度。`BlueComponent` 与 pi-tui 的 `Component` 结构兼容但类型独立。
- `ctx.blueTheme`（`BlueTheme`）——语义色表契约。每个值都是 `(text: string) => string` 的 ANSI 包装函数，覆盖 26 token 的 `BlueSemanticColors` 集合（全部 required）。契约留在本包 `src/types.ts`；实现以四个子路径插件发布，主题 provider 换装无需消费者改动：`./theme-dark`（`blue-theme-dark`，内置暗色调色板，plain 基线默认，导出 `DARK_COLORS`）、`./theme-light`（`blue-theme-light`，内置亮色调色板，导出 `LIGHT_COLORS`）、`./theme-auto`（`blue-theme-auto`，inject `blueTerminalInfo`，按探测到的终端背景选 dark/light，并在 `'blue/terminal-theme-changed'` 事件时换装 palette——连续换装经 promise 链序列化）与 `./theme-custom`（`blue-theme-custom`，JSON 文件把 token 名映射到 `#rrggbb`，叠加在内置 base 调色板之上；Config 经 `@deepseek-ai/schemastery` 校验，非法条目警告后回退 base 条目，文件不可读时整体回退 base 调色板）。四者都构建在内部模块 `src/theme-palette.ts` 之上：hex→ANSI 助手、`colorsFromForegrounds` 冻结色表构建器与 `defineThemeService` Service 子类工厂。
- `ctx.blueKeymap`（`BlueKeymap`）——键位注册表，分语境与全局两半。`register(actions)` 先整批校验（重复 id、键位已被其它动作占用）再提交，并返回 disposer；`matches(data, action)` 测试输入序列；`getKeys(action)` 解析已绑定键位。携带可选 `handler` 的动作是焦点无关的全局动作；不带 handler 的是语境动作，由组件经 `matches` 解析。`dispatch(data)` 运行全局半边：带 handler 的动作按注册序触发，并回报是否有 handler 消费了输入。本插件的 `apply` 自行接线全局半边——一个装在焦点路由之前的 pi-tui input listener 消费 `dispatch` 认领的输入——并直接实例化该服务（`new BlueKeymapService(ctx)`）而非经 `ctx.plugin`，因为 Cordis `Context` 代理会拒绝对未 inject 服务的访问，而服务无法 inject 自身。
- `ctx.blueTerminalInfo`（`BlueTerminalInfo`）——只读终端事实：`background`（`'dark' | 'light' | undefined`，来自启动时的 OSC 11 探测）与 `kittyKeyboard`（Kitty 键盘协议是否协商成功）。此后的 DEC 主题上报会发出 `'blue/terminal-theme-changed'` 事件（`'dark' | 'light'`）。
- `ctx.blueComponents`（`BlueComponents`）——组件工厂。`createEditor` / `createMarkdown` / `createSelectList` / `createSettingsList` 在 pi-tui 无关的接口背后构建 pi-tui 支撑的组件，并把当前 `blueTheme` 色表映射到 pi-tui theme；`visibleWidth` / `wrapText` / `truncateToWidth` 是共享的宽度纯函数。`BlueEditor` 契约还暴露 `setAutocompleteProvider(BlueAutocompleteProvider)`——类型独立的 `BlueAutocompleteItem` / `BlueAutocompleteSuggestions` / `BlueAutocompleteProvider` 三件套，由 L0 适配器原样透传给底层渲染器——以及 `getExpandedText()`，提交时用它把粘贴标记展开为完整内容。`BlueEditor` 还带前置拦截钩子 `onKey?(data)`——在 pi-tui Editor 处理输入序列之前调用，返回 `true` 即消费该序列（编辑器语境键链放在这里，因为 pi-tui Editor 吞掉 Ctrl-C 且自身没有兜底出口）——以及 `isShowingAutocomplete()`。工厂 inject `blueTheme`，provider 换装会经 Cordis reload 语义重建工厂。

五个契约都以 Cordis `Service` 子类挂载（`blueTheme` 由主题子路径插件挂载，其余由本插件的 `apply` 挂载）；插件 fiber 卸载时各自自动摘除。组件只消费这些接口，绝不接触 pi-tui 类型。

## 终端生命周期

`createTerminalRelease()` 返回供 `@deepseek-ai/dsh-app-boot` 的 `installFailLoud(binName, proc, release)` 使用的 `release` 函数：发生致命加载失败时，它停止当前活跃的终端栈（先 drain 未决输入），使进程退出前恢复 raw mode 与 bracketed paste。没有活跃 Blue 终端时它是 no-op。各服务经由稳定的代理引用委托，未来切换渲染器（主屏/alt-screen）无需消费者改动。

## 模型体验

无影响，因为终端 UI 核心面向用户渲染，不注册任何模型可见的内容。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **崩溃日志目录沿用 pi 默认值**——`TuiMainScreen` 把行宽溢出崩溃日志写到 `~/.pi/agent`（或 `PI_CODING_AGENT_DIR`），因为 pi-tui 硬编码了该默认值，而 Blue 尚无可传入的 dsh 侧路径；dsh 自有日志目录暂缓至 alt-screen 阶段。
- **仅主屏渲染器**——alternate-screen 视口与运行时渲染器切换暂缓；稳定代理引用是目前唯一预留的缝。
- **键位冲突检测范围**——冲突检测只覆盖经 `ctx.blueKeymap` 注册的动作；pi-tui 组件（Editor、SelectList）从 pi-tui 的全局键位表解析各自绑定，本包不动该表。
