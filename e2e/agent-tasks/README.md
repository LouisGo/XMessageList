# Agent Tasks

本目录包含面向 Codex App、Browser Use、Chrome DevTools MCP 及人工执行的工具中立任务。

规则：

- 场景语义位于仓库定义与页面桥接中。
- Agent 应优先调用桥接动作，降级时才回退到 DOM 交互。
- Oracle 是确定性的，以 evidence 驱动。
- 失败报告必须指明缺失的 evidence，而非猜测。

当前任务包：

- `p0-smoke.ai-task.md`
- `failure-report.prompt.md`
