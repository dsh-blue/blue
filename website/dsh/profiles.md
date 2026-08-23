# Profile 与目录

## Profile 是什么

Profile 是**存放在 Harness home 里的具名装配**：它列出要叠放的 bundle、持有自己的 `cordis.patch.yml` 覆盖层，并拥有独立安装的插件。启动 `dsh --profile blue` 时，装配按以下顺序分层：

1. **各 bundle**，按 profile 列出的顺序（`dsh-base` 永远是第一层：模型适配、工具、持久化、沙箱与审批策略、设置、凭据）
2. **profile 自己的 `cordis.patch.yml`**（profile 目录内）
3. **home 级 `cordis.patch.yml`**（`$DSH_HOME/cordis.patch.yml`，机器本地的全局偏好）
4. **`--patch` 覆盖层**（命令行追加，可重复）

patch 按 id 定位条目：要么整体替换其配置，要么插入新条目——**上层永远能改写下层**，这就是"每个表面都可定制"的机制保证。发行版自带 `web` 与 `headless` 两个模板 profile；Blue 的安装就是把 Blue bundle 装进你自己的 profile（见[快速上手](/guide/)）。

查看组装结果最直接的方式：

```sh
dsh --profile blue --dump-config     # 打印实际组装的完整插件树
```

## 目录结构

`DSH_HOME` 环境变量指定 Harness home（默认 `~/.dsh`）：

| 路径 | 内容 |
| --- | --- |
| `$DSH_HOME/profiles/<name>/` | 一个 profile：`cordis.patch.yml`、`package.json`、`node_modules`……自成一个 pnpm 工作区 |
| `$DSH_HOME/sessions/` | 会话持久化（JSONL 事件日志，供 `--resume` 与跨界面恢复） |
| `$DSH_HOME/storages/` | 各插件的存储区 |
| `$DSH_HOME/skills/` | 用户级 Skills（见 [Skills](/dsh/skills)） |
| `$DSH_HOME/cordis.patch.yml` | home 级全局 patch 覆盖层 |
| `$DSH_HOME/attachments/` | 附件存储（Blue 的默认位置，可用 `DSH_BLUE_ATTACHMENT_DIR` 改址） |

## profile 就是一个 pnpm 工作区

`dsh plugin --profile <name> add <pkg>` 原样转发给 profile 目录里的 pnpm——所以：

- 开发期装本地检出用 `link:` 协议（Blue 的[贡献指南](/plugins/contributing)正是这样链入十三个包）；
- profile 的依赖图变化才需要重新 `add`/`install`，改代码只需重建；
- 不想要哪个 profile，删掉 `$DSH_HOME/profiles/<name>/` 即可（自包含，无全局残留）。
