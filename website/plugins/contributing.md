# 贡献 Blue

Blue 是 pnpm 11 workspace，要求 Node `^22.19.0 || >=24.0.0`。当前发布集为
10 个 package：api、ui、frontend、conversation、app、core、transcript、
interaction、bundle 和 cli。

先阅读根 `AGENTS.md` 与 owning package 的 `AGENTS.md`。用户可见行为、
public seam 或 Website 变更必须在专用 worktree/branch 开发。

```sh
pnpm install
pnpm run verify:changed -- --plan
pnpm run verify:changed
pnpm run verify:full
```

发布形态另跑：

```sh
pnpm run check:lib
pnpm run check:pack
pnpm run check:examples
```

Runtime/public/composition 变更需安装专用 profile：

```sh
PROFILE=blue-my-change script/install-dev.sh
dsh --profile blue-my-change
```

Website 变更需 build 并通过 LAN preview 验收。适用的人类验收全部完成前，不
merge、不删除 profile、不停止 preview。
