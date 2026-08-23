# 主题

Blue 的视觉表面全部由一张**语义色表**驱动。`/theme` 命令在这张表的不同提供方之间热切换——切换会重建渲染树，但输入草稿、历史与输入模式经 draft stash 存活。

## /theme 用法

```
usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]
```

- `/theme` —— 打开**主题选择面板**：上下键移动即**实时预览**（整套 UI 含横幅鲸鱼渐变随之换色），`↵` 保留高亮主题，`esc` 还原打开时的主题。无显示服务的环境（如 headless）回退为文本列表
- `/theme dark` / `light` / `ocean` / `paper` —— 直接切到内置调色板
- `/theme auto` —— 跟随终端背景色（OSC 11 探测）自动选择明暗
- `/theme custom <path> [dark|light|ocean|paper]` —— 挂载文件调色板，`base` 指定兜底基线（默认 `dark`）

## 内置调色板

| 键 | 风格 | 横幅鲸鱼渐变 |
| --- | --- | --- |
| `dark` | 默认暗色（pi 系，品牌蓝高亮） | 深海军蓝 → 天蓝（品牌原渐变） |
| `light` | 浅色（GitHub primer 系，二级灰加深一档，不再发淡） | 深海军蓝 → 品牌蓝 |
| `ocean` | 蓝灰底冷色暗色（天蓝主色 + 青绿点缀） | 深海青 → 浅湖青 |
| `paper` | 暖纸底浅色（焦橙主色 + 墨青点缀） | 焦褐 → 纸黄 |

切换实现为 provider fiber 的整体替换：依赖主题的插件（transcript、输入层等）随之重载。挂载失败时会自动回退到内置 dark 调色板，界面永远不会没有主题。选择面板在每次实时预览切换后自动重新落座（输入层重建会短暂卸下面板，随即恢复）。

## custom：JSON 调色板

custom 主题从 JSON 文件读取 token 到 `#rrggbb` 十六进制色的映射，叠在 `base`（四套内置任选其一）之上：

```json
{
  "primary": "#4fa8ff",
  "accent": "#2bc8e8",
  "roleUser": "#4d6bfe",
  "selectedBg": "#3a3a4a",
  "modelHighlight": "#8ca8ff",
  "logoGradient": ["#2a3bd0", "#3247db", "#3b53e7", "#445ff2", "#4d6bfe", "#617cfe", "#758efe", "#899ffe", "#9db1ff"]
}
```

规则：

- 只需写想覆盖的 token，其余落到 base 的对应项；
- **未知 token**（不在下表中）与**非法颜色**（非 `#rrggbb` 格式）会被丢弃并打印警告，回退 base 对应项；
- `logoGradient` 是数组值 token：每项一个 `#rrggbb`，自上而下对应鲸鱼各行；数组为空、含非法项或不是数组时**整组回退** base 渐变；**短于九项时余行重复末项**；
- 文件不可读或不是 JSON 对象时，整表回退 base。

## 语义 token 表

以 dark 调色板的值为参照（light/ocean/paper 各有对应值；auto 按 OSC 11 探测结果在 dark/light 间二选一）：

### 基础

| token | dark 值 | 用途 |
| --- | --- | --- |
| `text` | `#e0e0e0` | 正文、状态栏最亮档（model、context） |
| `textStrong` | `#ffffff` | 强调文本 |
| `muted` | `#888888` | 次要文本、状态栏中档（cwd、git 徽章） |
| `textMuted` | `#6b6b6b` | 最暗档（工具摘要行、tips、代码块边框） |
| `accent` | `#2bc8e8` | 点缀色（指针、次强调） |
| `primary` | `#4fa8ff` | 主色（斜杠语境编辑框、运行态工具圆点、链接） |
| `border` | `#5a5a5a` | 常规边框 |
| `borderFocus` | `#e8a838` | 焦点边框（审批面板横线） |
| `success` | `#4ec87e` | 成功态 |
| `error` | `#e85454` | 错误态 |
| `warning` | `#e8a838` | 警告态 |
| `selectedBg` | `#3a3a4a` | 列表选中行背景 |
| `roleUser` | `#4d6bfe` | 用户消息 `❯` 边栏 |
| `shellMode` | `#bd93f9` | `!` bash 模式（编辑框、`$ ` 前缀） |

### 品牌件（横幅）

| token | dark 值 | 用途 |
| --- | --- | --- |
| `modelHighlight` | `#8ca8ff` | 横幅 Model 行高亮 |
| `logoGradient` | 9 项数组（`#2a3bd0` → `#9db1ff`） | 鲸鱼 logo 自上而下的每行渐变色 |

### Markdown 渲染

| token | dark 值 | 用途 |
| --- | --- | --- |
| `mdHeading` | `#e0e0e0` | 标题 |
| `mdLink` | `#4fa8ff` | 链接文字 |
| `mdLinkUrl` | `#6b6b6b` | 链接 URL |
| `mdCode` | `#4fa8ff` | 行内代码 |
| `mdCodeBlock` | `#e0e0e0` | 代码块正文 |
| `mdCodeBlockBorder` | `#6b6b6b` | 代码块边框 |
| `mdQuote` | `#888888` | 引用文字 |
| `mdQuoteBorder` | `#888888` | 引用竖线 |
| `mdHr` | `#5a5a5a` | 水平分割线 |
| `mdListBullet` | `#e0e0e0` | 列表符号 |

### diff 着色

| token | dark 值 | 用途 |
| --- | --- | --- |
| `diffAdded` | `#4ec87e` | 新增行 |
| `diffRemoved` | `#e85454` | 删除行 |
| `diffAddedStrong` | `#7ad99b` | 新增行（强调） |
| `diffRemovedStrong` | `#f08585` | 删除行（强调） |
| `diffGutter` | `#6b6b6b` | diff 行号槽 |
| `diffMeta` | `#888888` | diff 文件头元信息 |
