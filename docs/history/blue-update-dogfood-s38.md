# S38 用户侧安全更新（D52）dogfood 记录

日期：2026-08-23 · worktree `s38-update`（分支 `worktree-s38-update`）· 门禁：2078 测试全绿、per-file 100% 覆盖、typecheck/lint/build/check:lib/diagrams 全过。

## TUI 面（`blue-s38` 验收 profile，link 安装）

- `/update`（bare，rc tag == 运行版本）→ 数秒内回答 `up to date (v0.1.0-rc.2; rc tag: 0.1.0-rc.2)`，未触 profile——只读检查路径成立。
- `/update 0.1.0-rc.2`（显式版本）→ link 泳道门拦截，面板呈现完整多行修复配方与 `nothing was changed`。
- `/update` 进 slash 下拉（`→ /update [<version>] — Safely update Blue (preflight, snapshot, smoke, auto-rollback)`），/help 列表 39 行（两处钉数断言随更）。

## swap 面（scratch `DSH_HOME` + npm rc.2 profile，驱动 worktree 构建的 `lib/types/updater` 模块直连——已发布的 rc.2 无 /update，TUI 上无法演练新代码的 swap）

**演练 A：rc.2 → rc.2 全链路 no-op（16s PASS）** —— 快照 → `dsh plugin add` 同版本真装（**幂等性确认**，`dsh plugin add` 对已装同版本无破坏）→ 装后五包校验 → 真导入扫描（bundle patch 全部 `name:` 条目 + 三个钉版运行时依赖）→ 真 boot 冒烟（无 marker 降级路径：15s 存活 + /quit 阶梯 + exit 0）→ success + "重启生效"提示。

**演练 B：rc.2 → rc.1 真地雷（5s PASS，rolled-back）** —— rc.1 tarball 可装（安装步 ✓）→ 装后校验抓住树不成组（✗ verify）→ 自动回滚：快照恢复 + 五包 `@0.1.0-rc.2` 全组精确重装（✓ rollback）→ 复冒烟过 → `rolled back to 0.1.0-rc.2 · smoke passed`，update.log 落 profile 内 `.blue-update-backup/`。D51 级故障被装机时门禁真实拦截并恢复。

## dogfood 抓出的三个真 bug（全部随批修复 + 回归测试）

1. **错误结果单行截断**：阻断判定的多行修复配方经命令结果通道渲染时被截成一行 `...`，用户看不到配方。修复：阻断判定与失败结局改由 UpdatePanel 呈现（消息行 `components.wrapText` 换行而非截断），结果文本只留单行短摘要。
2. **硬编码六包集合**：`BLUE_PACKAGE_NAMES` 含未发布的 `blue-api`，对 rc.2（五包）用户的 verify 永远误判、回滚向 registry 索要从未发布的包（ETARGET）。修复：`readProfileFacts` 改为发现式扫描 `node_modules/@dsh-blue/*`；集合按目标版本从 registry 动态推导（`releaseFacts`）；组一致性门改判"已装集合版本混杂 + bundle 缺失"，成员齐全性归装后 verify 对目标集合管。
3. **`npm view --json` 形状**：`versions` 实为版本字符串数组（registry API 才是 manifest map），任意版本依赖不在文档内。修复：`normalizePackument` 兼容字符串数组/manifest 数组/map 三形；缺 deps 时经 `npm view pkg@version dependencies --json` 定向补查（一次查询同时供给集合与 harness 线）。

## 已确认的开放点

- 冒烟 B 的 marker 在真实 dsh 默认模型串下工作（blue-s38 TUI 内验证过 statusline 形态）；无 marker 的降级路径经演练 A 验证。
- pnpm 非 TTY 子进程 purge 提示：演练 A/B 的 `dsh plugin add` 子进程在 pipe 下正常完成，未见提示问题。
- PTY 驱动注意项：输入须分段发送（整块写入疑似撞上输入层的 paste-burst 处理）；`| tail` 会吞流式输出。


## 发版后真机矩阵（rc.3/rc.4，2026-08-23 续）

| 场景 | 结果 |
|---|---|
| rc.3 会话启动检查 | ✅ 真通知 "Blue v0.1.0-rc.4 is available"（真 registry、真 24h 缓存） |
| bare `/update`（rc.3/rc.4 会话） | ✅ up-to-date 只读回答，未触 profile |
| `/update 0.1.0-rc.3`（38min 新鲜） | ✅ 冷却期门拦截：面板 ETA `until 2026-08-23 21:59 UTC`，nothing was changed |
| `/update 0.1.0-rc.2`（410min） | ✅ 同上（窗内拒动）；profile 级 `minimumReleaseAge: 0` 关窗后放行 |
| 降级 rc.4→rc.2（关窗） | ✅ 安全链：单事务后兄弟滞留 rc.4 → 装后校验抓混树 → 自动整组回滚 rc.4 → 复冒烟 ✓ |
| 成功路径 `/update 0.1.0-rc.4`（关窗 no-op） | ✅ 12s 全程：confirm y → 装幂等 → 真冒烟 → "restart dsh to apply" |

另：rc.3 的 target-exists 误判（npm-view 裸键）即由本矩阵第 2 轮真机抓出 → rc.4 修复（`Object.hasOwn`）+ 回归 fixture。

