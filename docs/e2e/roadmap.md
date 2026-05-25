# AI-first E2E Roadmap

## 1. North Star

建立一套以 Browser Use / Chrome DevTools MCP / Codex App 为一等公民的
IM message list e2e 体系：

```text
stable scenario host
-> AI-readable state/action/evidence bridge
-> deterministic oracle
-> repeatable agent tasks
-> high-signal failure report
```

## 2. Phase 0: Documentation And Contract Freeze

Status: current phase

Deliverables:

- `docs/e2e/README.md`
- `docs/e2e/architecture.md`
- `docs/e2e/ai-agent-contract.md`
- `docs/e2e/evidence-and-oracles.md`
- `docs/e2e/scenario-matrix.md`
- `docs/e2e/roadmap.md`

Exit criteria:

- e2e 不再被定义为“写一些浏览器脚本”。
- Browser Use / Chrome DevTools MCP 是执行层，不是场景语义所有者。
- P0/P1/P2/P3 场景优先级清晰。
- Evidence 和 oracle 合同可直接指导实现。

## 3. Phase 1: E2E Host Skeleton

Goal:

建立可打开、可 reset、可读状态的 `/e2e` 宿主。

Implementation scope:

- 新增 e2e-only app route 或 query entry。
- 复用 demo runtime cache 和 scenario hook。
- 固定 seed 和初始 feed。
- 默认开启 runtime diagnostics。
- 页面渲染 `data-testid="e2e-ai-status"`。
- 暴露 `window.__X_MESSAGE_LIST_E2E__.version = 1`。

Exit criteria:

- Codex / Browser Use 可打开 `/e2e?scenario=bootstrap.latest-bottom-lock`。
- `getState()` 返回 feed、runtime、viewport、ui、safety 基础字段。
- `resetScenario(id)` 可稳定重置场景。
- 不影响普通 demo。

Risks:

- Vite route / demo route 结构可能需要调整。
- 固定 seed 不能破坏现有 demo 随机性。

## 4. Phase 2A: Minimal P0 Action And Evidence Bridge

Goal:

让 AI agent 不猜 DOM，并且能完成 P0 场景所需的最小动作和证据采集。

Implementation scope:

- 实现 `listActions()`。
- 实现 `runAction()`。
- 实现最小版 `getEvidence()`。
- 采集 feed / runtime / viewport 基础状态。
- 采集 visible message ids 和 anchor DOM rect。

Initial actions:

- `wait_for_ready`
- `wait_for_idle`
- `collect_evidence`
- `scroll_to_middle`
- `scroll_to_history_top`
- `append_message`
- `prepend_history`
- `follow_bottom`

Exit criteria:

- Browser Use / Chrome DevTools MCP 只用 bridge 就能完成 P0 action flow。
- P0 场景需要的 evidence 字段齐全。
- `wait_for_idle` 不会把 pending demo async operation 误判为 idle。

Risks:

- wait idle 需要定义清楚，不能误把 pending async demo operation 当 idle。
- DOM visible row 计算必须基于真实 rect，不能只读 projection。

## 5. Phase 2B: Evidence Hardening And Failure Artifacts

Goal:

把最小 evidence 升级为可归因、可保存、可复读的失败证据包。

Implementation scope:

- 采集 console error/warn。
- 采集 viewport events ring buffer。
- 采集 runtime diagnostics ring buffer。
- 每个 action result 支持 before / after evidence。
- 生成 evidence JSON。
- 生成基础 markdown failure report。

Exit criteria:

- Evidence JSON 可保存并离线阅读。
- 失败报告能区分 demo / React / runtime / browser / harness。
- P0 失败不需要重新手动复现才能定位第一层归因。

Risks:

- diagnostics 过多会稀释关键信号，需要保留优先级和 ring buffer 上限。
- failure report 不能依赖 AI 主观总结，必须从 evidence 字段生成核心事实。

## 6. Phase 3A: P0 Deterministic Oracles

Goal:

落地最小 IM e2e 门禁。

Implementation scope:

- `expectRuntimeIdle`
- `expectBottomLocked`
- `expectAnchorPreserved`
- `expectNoFollowWhenUserReading`
- P0 scenario definitions

P0 scenarios:

1. `bootstrap.latest-bottom-lock`
2. `paging.prepend-anchor-preservation`
3. `bottom.user-scroll-up-append-no-follow`

Exit criteria:

- 三个场景可重复运行。
- P0 oracle 可以直接消费 `getEvidence()` 输出。
- 无需 LLM 判断即可得到 pass/fail。

Risks:

- 阈值需要基于真实浏览器像素误差调校。
- 现有 demo policy 可能缺少精确控制动作，需要补 e2e-only action。

## 7. Phase 3B: Local MCP/CDP Runner Prototype

Goal:

在 P0 bridge 和 oracle 已经稳定后，再补一个可重复执行的本地 runner 原型。

Implementation scope:

- 本地 MCP / CDP runner 原型。
- 按 scenario action list 执行动作。
- 下载 evidence JSON。
- 调用 deterministic oracle。
- 输出 markdown failure report。

Exit criteria:

- 不依赖 LLM 也能复跑 P0。
- runner 只适配执行层，不拥有 scenario / evidence / oracle 语义。
- 本地失败输出和 agent 失败输出使用同一 evidence/report 格式。

Risks:

- 过早绑定某个 MCP 工具 API 会增加维护成本；runner 必须保持薄适配层。
- 如果 P0 bridge 不稳定，runner 会放大噪声。

## 8. Phase 4: Agent Task Pack

Goal:

让 Codex App / Browser Use 能按任务文件稳定执行和复现。

Implementation scope:

- 先写一个 P0 smoke task，验证任务格式。
- `e2e/agent-tasks/*.md`
- 任务文件包含 goal、allowed actions、success oracle、evidence checkpoints。
- 为失败报告提供 prompt 模板。
- 增加 shortest-repro workflow。

Exit criteria:

- AI agent 可以执行 P0 任务并输出 evidence-based 结论。
- AI agent 失败时能说明缺失证据，而不是猜测。
- 人工可以复制 action sequence 复跑。

Risks:

- 不同 agent 的工具名称不同，需要保持任务描述工具无关。
- 如果页面语义不足，agent 会退化为视觉猜测。
- 任务文件不应早于 P0 oracle 大规模铺开，否则会随 bridge 改动反复返工。

## 9. Phase 5: P1 Core IM Matrix

Goal:

覆盖核心 IM 体验。

Scenarios:

- `bottom.locked-append-follow`
- `destination.quote-jump-visible-target`
- `dynamic-height.anchor-above-growth`
- `session.switch-restore-runtime-cache`

Exit criteria:

- quote jump、dynamic height、session switch 都有 evidence 和 oracle。
- 失败可归因到 demo / React / runtime / browser / harness。

Risks:

- Session switch 涉及 runtime cache 和 persisted anchor，需要严格隔离 seed。
- Quote jump 的 deleted fallback 需要单独定义 oracle。

## 10. Phase 6: P2 Recovery And Edge Matrix

Goal:

覆盖近期高风险边缘路径。

Scenarios:

- `edge.custom-scrollbar-drag-top`
- `edge.custom-scrollbar-drag-bottom`
- `lifecycle.strictmode-attach-detach-attach`
- `recovery.bootstrap-commit-timeout`

Exit criteria:

- direct scroll / drag edge 不误判 recovery scroll。
- StrictMode 不重复 observer、不丢 detach anchor。
- commit timeout recovery 不误触发 edge need。

Risks:

- Browser Use 对 drag 精度可能不足；必要时 action bridge 需要提供 semantic drag。
- StrictMode 场景可能需要专用 host 开关。

## 11. Phase 7: P3 AI Stress And Exploration

Goal:

让 AI agent 发挥探索价值，但不污染稳定门禁。

Scenarios:

- `storm.quote-jump-during-event-storm`
- `storm.follow-bottom-with-bot-push`
- `storm.dynamic-height-session-switch`

Exit criteria:

- AI 可以生成 shortest repro。
- Evidence 足够串起 command -> transaction -> projection -> motion -> settle。
- P3 不作为基础 CI 门禁，只作为发布前或专项探索。

Risks:

- Event Storm 随机性必须可 seed。
- AI exploration 可能产生高噪声报告，需要 report schema 约束。

## 12. Phase 8: Separate Performance Gates

Goal:

把性能预算从 correctness gate 中拆出来，单独用 `--priority perf` 执行，避免机器负载让 P0/P1/P2 产生噪声。

Scenarios:

- `perf.bootstrap-latest-budget`
- `perf.send-ack-latency-budget`
- `perf.prepend-latency-budget`

Exit criteria:

- Evidence 包含 action duration、Long Task、frame gap。
- 首批只覆盖稳定预算，不做复杂 trace / 设备分档 / CI 性能基线。
- perf 失败报告能指出是 action latency、long task 还是 frame gap 超预算。

Risks:

- 性能阈值天然受机器负载影响，必须保持独立运行。
- 浏览器后台化会影响 frame gap，需要在 failure report 中保留原始 evidence。

## 13. Long-term Maintenance Rules

- 每个 runtime bugfix 如果涉及真实浏览器 timing，应补一个 scenario 或 oracle。
- 新增 scenario 必须先写 markdown task，再实现 bridge/action。
- P0 不允许依赖 AI 主观判断。
- P1/P2 可以使用 AI 辅助执行，但最终必须落到 evidence oracle。
- P3 报告必须包含 shortest repro，否则不进入回归矩阵。
