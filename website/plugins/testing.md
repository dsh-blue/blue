# 调试与验证

普通 Cordis 插件使用普通测试工具。至少覆盖：

1. TypeScript strict typecheck 与 lint。
2. 用真实 Cordis `Context` 挂载依赖 service 和插件 entry。
3. Native command/projection/tool 调用保持 dsh 原生形态。
4. `blueCurrentAgent` 使用 registry 中的精确 Agent，并正确处理
   `null`、切换与 dispose。
5. Pane/status/overlay/editor extension 的 definition 与 render output。
6. Plugin Fiber dispose 后所有 registration、listener 与 timer 消失。
7. 异步 callback 的 abort、timeout 与迟到结果。
8. UI 在 20/40/80/120 列下不越界。

打包门：

```sh
npm pack --dry-run
```

再把实际 tarball 安装到空目录，import public entry，检查 `exports`、
`types`、`files`、peer resolution，并确保没有 `workspace:`、`link:` 或
开发机绝对路径泄漏。

最后在专用 profile 安装 file snapshot，完成启动、主流程、窄宽、session
切换、unload 与 restart 的人工验收。
