# Blue 文档索引

当前运行时只有两份架构文档：

- [blue-architecture.md](./blue-architecture.md)：包边界、状态所有权和 flat
  Cordis composition。
- [blue-seams.md](./blue-seams.md)：dsh 原生服务、Blue UI 服务与
  `blueCurrentAgent` 的使用边界。

发布维护见 [package-release.md](./package-release.md)。既有版本说明位于
`release-notes/`，历史调研与验收记录位于 `history/`；这些文件只描述其
当时时点，不定义当前 API。

插件作者应从 Website
[开发手册](https://dsh-blue.dev/plugins/) 开始，并以
[DeepSeek Harness reference](https://deepseek-harness.github.io/deepseek-harness/reference/)
为 dsh 原生服务依据。仓库维护规则见根 [AGENTS.md](../AGENTS.md) 与各包
`AGENTS.md`。
