# R5 Dogfood 记录:registry 安装跑完整真实任务

> 2026-08-22 · 首次以**纯 npm 安装**(非 dev link)的 Blue 完成端到端真实任务并归档。
> 会话全文见 [blue-dogfood-r5-session.md](./blue-dogfood-r5-session.md)(`/export` 原样归档,39KB)。

## 环境

| 项 | 值 |
| --- | --- |
| 安装方式 | `dsh plugin --profile blue add @dsh-blue/blue@0.1.0-rc.2`(精确版本,D51 修复后的干净 profile) |
| Blue / bundle | `0.1.0-rc.2`(npm tarball,非 link) |
| harness | `dsh` CLI 0.1.1-rc.2(npm latest) |
| 模型 | 开箱默认 `deepseek-v4-flash`(官方路由,真实 key) |
| 驱动 | PTY 逐键击入(`.claude/tmp/r5/drive.py`,模拟真人节奏);全程录屏 977KB typescript |
| 工作目录 | `/var/tmp/dogfood-r5`(空 git 仓库) |

## 任务

两轮中文自然语言任务:

1. 写 `urlcheck.sh`(curl 给定 URL,2xx 绿 / 3xx 黄 / 4xx-5xx 红,`--timeout N`、`--retry N`,失败非零退出)+ `README.md`;
2. 追加 `--json` 输出模式(url/status/ok/ms 一行 JSON)并用 `https://example.com` 实测。

## 结果

- **2 turns · 16 tool calls · 46 messages**,`/yolo` 模式,工具全程无阻塞;
- 产物:`urlcheck.sh`(4413B,参数校验/TTY 色彩探测/0-1-2 三档退出码)+ `README.md`(3928B,用法表与示例);
- 模型自发做了 `bash -n` 语法检查、`--help` 冒烟、**三条实测**(真实网络):

  ```json
  {"url":"https://example.com","status":200,"ok":true,"ms":987}
  {"url":"https://example.com/nonexistent-xyz","status":404,"ok":false,"ms":969}
  {"url":"http://badhost.invalid.zzz","status":null,"ok":false,"ms":63}
  ```

- `/export` 产出 39KB 结构化 Markdown(session 元数据 + 分 turn + 工具全录);
- `/quit` 干净退出,**exit 0**;
- 977KB typescript 全扫:**零 `ERR_*`、零 `Cannot find`、零异常栈、零 WARN**。

## 结论与遗留

- R3/R4 修复链(files 整目录 / 桥依赖自带 / 精确版本装机)在真实任务下**零阻塞项**——按 R5 定义,无需回修重走 R3-R4。
- 本次驱动为合成击键,视觉细节由 VT 快照套件与人工目检另行覆盖;本次录屏未观察到任何渲染异常。
- **G4 达成**;R 系列仅剩 R6a(文档站四页还清,暂缓中)。

## 工件位置

- 会话导出(入档):`docs/history/blue-dogfood-r5-session.md`
- 录屏与驱动脚本(本机):`.claude/tmp/r5/`(git-ignored)
- 任务产物(本机,保留至下个发版):`/var/tmp/dogfood-r5/`
