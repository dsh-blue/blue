# 收录指南

把你的插件收录进[插件市场](/marketplace/)：往 [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace) 仓库提交一个 PR 即可。本页说明收录标准、注册表字段、详情页写法与审查流程。

## 收录标准

- **可安装**：插件能通过 `blue plugin add <spec>` 从公开源安装（GitHub 源即可；npm 不是门槛，发布后补一条安装源即可）。包名必须包含 `blue`、`frontend` 或 `adapter` 之一，与主仓校验规则一致；
- **基于公开能力**：只使用当前 Beta host 接受的能力，且声明与实际相符。Beta 能力为 `commands` / `status` / `notifications.publish` / `panes` / `overlays` / `session.read`；`editor.extensions` / `status.provider` / `editor.provider` 只能明确标为 Experimental/reference（能力契约见[核心概念](/plugins/concepts)）；
- **双语基本信息**：`title` 与 `tagline` 必须中英齐全；tagline 用一句动作句概括插件做什么（中文 ≤60 字符、英文 ≤100 字符、英文以句号结尾、不用 emoji）；
- **信息如实**：`version`、`license` 与源仓库一致。

插件怎么写、怎么验证，从[快速开始](/plugins/quickstart)入手；发布前建议过一遍[调试与验证](/plugins/testing)。

## 注册表字段

收录即往 `registry.json` 的 `plugins` 数组**末尾追加**一条：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✓ | 唯一标识，即市场 URL 路径与 `content/<id>/` 目录名；`^[a-z0-9][a-z0-9-]*$`，`submit` 为保留字 |
| `package` | ✓ | 目标包名（与源仓库 `package.json` 的 `name` 一致） |
| `version` | ✓ | 展示用版本号 |
| `title` | ✓ | 双语展示名 `{ "zh": ..., "en": ... }` |
| `tagline` | ✓ | 双语一句话描述（风格要求见上） |
| `author` | ✓ | 作者展示名 |
| `repo` | ✓ | `https://github.com/<owner>/<repo>` 源码仓库 |
| `install` | ✓ | 安装源数组（至少一项，**顺序即偏好序**，卡片展示第一项）：`{ "kind": "github" \| "git" \| "npm" \| "tarball", "spec": ... }`，`spec` 可直接拼进 `blue plugin add <spec>` |
| `capabilities` | ✓ | 使用的 Blue 能力 |
| `categories` | ✓ | 分类，取值见仓库 `categories.json` 词表 |
| `license` | ✓ | SPDX 标识 |
| `verified` | ✓ | 提交时一律 `false`，由维护者在 review 中翻转 |
| `added` | ✓ | 收录日期 `YYYY-MM-DD` |
| `npm` |  | 发布到 npm 后填包名，未发布填 `null`；含 `npm` 安装源时不可为 `null` |
| `image` |  | 卡片封面/详情头图，`content/<id>/assets/` 下的相对路径，暂无填 `null` |

首个收录条目 `blue-doudizhu` 可作参考：

```json
{
  "id": "blue-doudizhu",
  "package": "@dsh-blue/blue-doudizhu",
  "version": "0.1.0",
  "title": { "zh": "斗地主", "en": "Doudizhu" },
  "tagline": {
    "zh": "在底部面板里打斗地主：字符牌局、本地 Bot 对手与积分排行榜。",
    "en": "Play Doudizhu in a bottom pane: a character-drawn card table, local bots, and a score leaderboard."
  },
  "author": "dsh-blue",
  "repo": "https://github.com/dsh-blue/blue-doudizhu",
  "install": [
    { "kind": "github", "spec": "github:dsh-blue/blue-doudizhu" },
    { "kind": "git", "spec": "git+https://github.com/dsh-blue/blue-doudizhu.git" }
  ],
  "capabilities": ["commands", "panes"],
  "categories": ["games"],
  "license": "MIT",
  "verified": true,
  "npm": null,
  "image": null,
  "added": "2026-08-27"
}
```

## 详情页写法

每个插件需要双语详情页 `content/<id>/zh.md` 与 `content/<id>/en.md`，网站会渲染为 `/marketplace/<id>/` 与 `/en/marketplace/<id>/`。写作约定：

- 文件以 frontmatter `title:` 开头，正文含一个一级标题；
- 按需分节：概述 → 前置条件（装 Blue）→ 安装 → 命令/用法 → 能力 → 特性 → 常见问题；
- **安装命令与元信息不要手抄**：用全局组件从注册表渲染——`<InstallCommand command="blue plugin add <spec>" />` 渲染可复制的安装命令，`<PluginMeta id="<id>" />` 渲染版本/license/仓库等元信息；这样版本号等信息只需维护 `registry.json` 一处；
- 站内链接写带语言前缀的绝对路径（中文页 `/plugins/...`、英文页 `/en/plugins/...`）；页面末尾放"返回插件市场"链接。

范例见 marketplace 仓库 [`content/blue-doudizhu/`](https://github.com/dsh-blue/marketplace/tree/master/content/blue-doudizhu)。

## PR 流程

1. Fork [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace)，新建分支；
2. `registry.json` 末尾追加条目 + 新增 `content/<id>/zh.md`、`en.md`；
3. 提交 PR，标题 `add: <id>`；
4. **一个插件一个 PR**；只允许改动 `registry.json` 与自己的 `content/<id>/` 目录（更新自己的插件时同样只动自己的条目和目录），改动他人条目会被拒绝；
5. `verified` 填 `false`；CI 校验与人工 review 通过后合并，网站最迟次日更新（每日定时重建）。

## CI 自动校验

PR 会自动运行 [validate-registry](https://github.com/dsh-blue/marketplace/blob/master/script/validate-registry.mjs)，提交前可在本地运行 `node script/validate-registry.mjs` 自查。校验项：JSON 可解析；字段白名单（未知键报错，防拼写错误被静默忽略）；`id` 唯一、格式与保留字；包名规则；`repo` 格式；安装源合法性（含 npm 源时 `npm` 字段非空）；能力与分类在词表内；tagline 双语齐全、长度与风格；双语详情文件存在且有 frontmatter `title` 与一级标题；`content/` 目录与条目一一对应；**非维护者在 PR 中引入 `"verified": true` 直接失败**。

## 人工 review 清单

维护者合并前会核对：

- 按注册表 `install` 的第一项**实际安装**一次（`blue plugin add <spec>`），重启 Blue，确认命令/面板出现；
- `capabilities` 与插件实际使用相符；`version`、`license` 与源仓库一致；
- tagline 双语等值、动作句开头；详情页站内链接语言前缀正确。
