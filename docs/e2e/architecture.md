# E2E Architecture

## 1. Architecture Summary

XMessageList 的 e2e 体系由六层组成：

```text
AI / MCP runner
-> execution adapter
-> e2e scenario host
-> semantic action contract
-> evidence collector
-> deterministic oracle
```

各层职责必须保持清晰。执行层可以替换，场景、证据和 oracle 不能绑定到某个工具。

## 2. Layer Responsibilities

| Layer | Responsibility | Current Preference |
| --- | --- | --- |
| AI / MCP runner | 调用浏览器、执行用户级任务、生成最短复现 | Codex App, Browser Use, Chrome DevTools MCP |
| Execution adapter | 把 agent 操作翻译成浏览器导航、点击、滚动、脚本读取 | CDP / MCP adapter |
| Scenario host | 提供固定 seed、固定数据窗口、固定 UI 和 dev-only debug bridge | `/e2e` route |
| Semantic action contract | 暴露稳定动作，例如 `scroll_to_history_top`、`append_message` | `window.__X_MESSAGE_LIST_E2E__` |
| Evidence collector | 采集 runtime、DOM、console、viewport events、diagnostics | project-owned collector |
| Deterministic oracle | 根据 evidence 判断 pass/fail | project-owned assertions |

## 3. Why Not Tool-owned E2E

Browser Use / Chrome DevTools MCP 应该是执行能力，不应该成为测试语义本身。原因：

- 工具 API 会变化，IM 场景合同不能跟着变化。
- LLM 行为可能有随机性，机器 oracle 必须稳定。
- 真实问题定位需要 runtime diagnostics，而不是只看“页面看起来对不对”。
- 我们要复用场景给人工、Codex、Browser Use、CI smoke、回归复现，而不是维护多套测试。

因此，长期资产应该在仓库内：

- scenario definitions
- action schema
- evidence schema
- oracle functions
- failure report format

## 4. Scenario Host

建议新增独立 e2e 宿主，而不是直接把普通 demo 页面当测试目标：

```text
/e2e
/e2e?scenario=bootstrap.latest-bottom-lock
/e2e?scenario=paging.prepend-anchor-preservation
```

宿主可以复用现有 demo 代码：

- `DemoMessageViewport`
- `useDemoMessageScenario`
- demo data generator
- feed runtime cache
- advanced mock scenarios

但必须增加 e2e-only 控制：

- fixed random seed
- deterministic clock option where possible
- selected initial feed
- controlled data window size
- diagnostics enabled
- stable AI status region
- scenario reset button / API

普通 demo 可以保持面向人类调试；e2e host 面向 agent 和 oracle。

## 5. Runtime Boundary

e2e 不能绕过 runtime 的状态机：

- 不直接修改 `scrollTop` 后立即断言状态，必须等待 runtime idle / projection commit。
- 不直接改 DOM row 高度绕过 React 数据流，除非该场景明确测试浏览器动态 layout。
- 不直接调用私有 coordinator。
- 可以通过 public runtime facade、demo policy action、DOM input 和 e2e debug bridge 获取证据。

可以读取 debug/evidence：

- runtime snapshot
- debug snapshot
- diagnostic records
- viewport events
- DOM geometry
- console logs

但最终行为断言应优先基于 observable state：

- visible message ids
- anchor rect delta
- distance to bottom
- bottom lock state
- target row visibility
- absence of console errors

## 6. Execution Modes

### 6.1 Agent Interactive Mode

用于 Codex App / Browser Use 手动探索：

- agent 打开 `/e2e?scenario=...`
- agent 读取 AI state
- agent 选择 action
- agent 收集 evidence
- agent 输出失败归因和最短复现

### 6.2 Deterministic Script Mode

用于本地稳定复跑：

- Node 脚本通过 Chrome DevTools MCP 或 CDP adapter 打开页面。
- 按 scenario action list 执行动作。
- 下载 evidence JSON。
- 运行 oracle。

这不是 Playwright-first；它是 MCP / CDP-first 的 deterministic runner。

### 6.3 AI-assisted Regression Mode

用于复杂场景：

- agent 可以自由选择 action 顺序。
- 每一步必须调用 `getEvidence()`。
- 最后仍然提交 evidence 给 deterministic oracle。
- 如果 oracle 失败，agent 生成 shortest repro draft。

## 7. Evidence Flow

```text
browser state
-> page bridge getEvidence()
-> evidence artifact JSON
-> oracle
-> markdown failure report
-> optional screenshot / trace / console attachment
```

evidence 必须可独立保存和复读。任何“我看到页面跳了”的结论都必须转成 evidence 字段，
例如：

```json
{
  "anchor": {
    "before": { "messageId": "m-120", "top": 184 },
    "after": { "messageId": "m-120", "top": 184.5 },
    "delta": 0.5
  }
}
```

## 8. Failure Triage Model

每个失败必须归到一个 primary owner：

| Owner | Examples |
| --- | --- |
| demo policy | seed 不稳定、mock storm 过激、业务按钮状态错误 |
| React projection | commit ack 过早/过晚、ref 注册顺序错误、StrictMode cleanup 问题 |
| runtime state machine | transaction 卡住、phase 错乱、bottom lock 污染、anchor correction 错误 |
| browser timing | ResizeObserver / IntersectionObserver / input event loop 竞争 |
| test harness | action 未等待 idle、证据采集时机错误、oracle 阈值不合理 |

不能只写“e2e failed”。报告必须说明证据链缺了哪一段。

## 9. File Layout

建议后续实现使用：

```text
src/e2e-app/
  E2EMessageViewportApp.tsx
  e2eBridge.ts
  e2eScenarioRegistry.ts
  e2eEvidence.ts
  e2eOracles.ts

e2e/
  scenarios/
    bootstrap.latest-bottom-lock.md
    paging.prepend-anchor-preservation.md
  agent-tasks/
    smoke.ai-task.md
  runner/
    runScenario.ts
    chromeDevToolsMcpAdapter.ts
```

具体路径可以在实现时调整，但必须保留分层。

