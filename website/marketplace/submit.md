# 提交插件

收录前请确认：

1. package 是普通 Cordis entry，并通过自己的 `cordis.patch.yml` 激活；
2. README 列出 native dsh 与 Blue UI `inject`；
3. tarball 在空目录可独立安装，export/type/files 完整；
4. 测试覆盖 Fiber unload、Agent/session scope、异步 abort 与 UI 窄宽；
5. 在专用 Blue profile 完成真实启动与主流程验收；
6. package 名、repository、license、版本、支持矩阵与维护者明确。

提交市场 PR 时附 npm package、repository、简短描述、服务列表、截图或录屏、
验证命令与验收 profile。市场收录不替代 npm 发布授权或 package 自己的安全审查。
