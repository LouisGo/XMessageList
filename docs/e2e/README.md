# AI-first E2E Testing

本目录定义 XMessageList 的下一代 e2e 测试体系。目标不是把现有 demo
脚本化，也不是复制通用虚拟列表库的 e2e，而是建立一套面向 IM / AI 对话消息列表的
真实浏览器验证系统。

这套体系优先支持 Browser Use、Chrome DevTools MCP、Codex App 内置浏览器调试等
现代 AI agent 工作流。Playwright 可以作为外部参考，但不是本项目 e2e 的主执行层。

## 1. Goals

- 标准化：所有场景使用统一的 scenario、action、evidence、oracle 合同。
- 场景化：测试围绕 IM 消息列表，而不是通用 list/grid/windowing 能力。
- 真实化：在真实 Chromium / Chrome 环境中验证 scroll、layout、ResizeObserver、
  IntersectionObserver、input event loop 和 React commit timing。
- 专业化：保留机器可判定的 pass/fail，不把最终正确性完全交给 LLM 主观判断。
- AI 友好化：页面必须暴露稳定的语义状态、操作清单和证据包，让 AI agent 不需要猜 DOM。

## 2. Non-goals

- 不建立 Playwright-first 测试体系。
- 不让 AI 直接替代确定性断言。
- 不把普通 demo 页面变成测试 oracle。
- 不测试通用虚拟列表全部能力，例如 grid、horizontal、table、RTL 等非 IM 主线场景。
- 不通过私有 runtime 字段做主要断言；debug state 只能作为证据和归因辅助。

## 3. Document Map

- [architecture.md](./architecture.md)：整体架构、分层、所有权边界。
- [ai-agent-contract.md](./ai-agent-contract.md)：AI / MCP / Browser Use 可操作合同。
- [scenario-matrix.md](./scenario-matrix.md)：标准场景矩阵与优先级。
- [evidence-and-oracles.md](./evidence-and-oracles.md)：证据采集、机器 oracle 和失败报告。
- [roadmap.md](./roadmap.md)：分阶段推进路线图。

## 4. Relationship To Existing Docs

本目录不替代 `docs/viewport-runtime/lifecycle-and-testing.md`。后者定义 runtime 的生命周期、
清理、generation safety 和浏览器集成测试清单；本目录把这些测试要求升级成
AI-first e2e 架构。

关键约束仍以 viewport runtime 文档为准：

- Runtime 拥有 scroll / measurement / transaction / projection / edge paging。
- React 只负责 projection adapter、DOM ref 注册和 commit ack。
- Demo / app policy 可以模拟数据和业务交互，但不能绕过 runtime 状态机。
- e2e 失败归因必须区分 demo policy、React projection、runtime state machine、
  browser timing 四类问题。

## 5. External References

本方案主要参考以下执行层能力：

- Chrome DevTools MCP: <https://github.com/ChromeDevTools/chrome-devtools-mcp>
- Chrome DevTools MCP announcement: <https://developer.chrome.com/blog/chrome-devtools-mcp>
- Browser Use: <https://github.com/browser-use/browser-use>
- Browser Use docs: <https://docs.browser-use.com>

virtua 和 react-virtuoso 的 e2e 仅作为组织参考：

- virtua 将 e2e 独立成目录，并通过真实浏览器访问 story iframe。
- react-virtuoso 为 regression 准备独立 examples，并覆盖 prepend / follow output 等行为。
- 但两者都不是 IM 消息列表的完整证据与 AI-agent 合同范式。

## 6. Canonical Test Shape

每个 e2e 场景都必须由四部分组成：

```text
scenario definition
-> browser / agent actions
-> evidence collection
-> deterministic oracle
```

AI agent 可以参与 action 执行、探索和最短复现生成，但 oracle 必须可以在无 LLM 的情况下
复算。

## 7. Recommended First Slice

首批只做 P0：

1. `bootstrap.latest-bottom-lock`
2. `paging.prepend-anchor-preservation`
3. `bottom.user-scroll-up-append-no-follow`

这三个场景覆盖 runtime 最核心的 IM 价值：

- 首屏 latest 进入可用状态。
- 历史分页不打散阅读位置。
- 用户阅读历史时新消息不抢滚。

