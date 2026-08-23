# @dsh-blue/blue-remote

Blue 的 F4 headless session runtime，提供多 session projection registry、current-session binding，以及 dsh-remote 风格的 capability negotiation、seq resume、write lease、action 和 question/approval proxy。

本包不依赖 TUI 或终端 API。真实 daemon 只需实现 `RemoteTransport`；测试中的确定性 transport 是 Blue 自动化门禁使用的协议 fixture。
