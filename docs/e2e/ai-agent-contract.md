# AI Agent Contract

## 1. Purpose

AI agent 不应该通过猜测页面结构完成 e2e。XMessageList 的 e2e 页面必须暴露稳定、
低歧义、可机器读取的合同，让 Browser Use、Chrome DevTools MCP、Codex App 等工具
能可靠地完成操作和归因。

## 2. Global Bridge

e2e host 应在 dev / e2e 环境暴露：

```ts
declare global {
  interface Window {
    __X_MESSAGE_LIST_E2E__?: XMessageListE2EBridge
  }
}

type XMessageListE2EBridge = {
  version: 1
  getState: () => E2EState
  listActions: () => E2EActionDescriptor[]
  runAction: (
    actionId: string,
    payload?: Record<string, unknown>,
  ) => Promise<E2EActionResult>
  getEvidence: () => E2EEvidence
  resetScenario: (scenarioId: string) => Promise<E2EActionResult>
}
```

Bridge 只在 e2e host 打开，不进入生产包 public API。

## 3. State Schema

`getState()` 返回 agent 当前需要理解页面的最小状态：

```ts
type E2EState = {
  scenarioId: string
  scenarioStatus: 'booting' | 'ready' | 'running' | 'failed'
  feed: {
    activeFeedId: string
    generation: number
    revision: number
    title: string
  }
  runtime: {
    state: string
    readySubstate: string
    viewportPhase: string
    transactionState: string
    destinationState: string
    bottomLockState: string
    pendingCommands: number
    motionActive: boolean
    observedRows: number
    heightCacheSize: number
    lastScrollSource: string | null
  }
  viewport: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    distanceToBottom: number
    topSpacer: number
    bottomSpacer: number
    visibleMessageIds: string[]
    firstVisibleMessageId: string | null
    lastVisibleMessageId: string | null
  }
  ui: {
    feedLoading: boolean
    loadingBefore: boolean
    loadingAfter: boolean
    eventStormRunning: boolean
    botPushActive: boolean
    dynamicHeightEnabled: boolean
    pendingOperation: string
    lastEvent: string
  }
  safety: {
    consoleErrors: number
    consoleWarnings: number
    lastViewportError: string | null
  }
}
```

字段可以继续扩展，但已有字段必须保持兼容。

## 4. Action Descriptors

`listActions()` 返回当前允许执行的动作。AI agent 必须优先使用这些动作，而不是随意点 DOM：

```ts
type E2EActionDescriptor = {
  id: string
  label: string
  category:
    | 'bootstrap'
    | 'scroll'
    | 'paging'
    | 'message'
    | 'destination'
    | 'feed'
    | 'mock'
    | 'evidence'
  enabled: boolean
  reasonDisabled?: string
  payloadSchema?: Record<string, unknown>
}
```

首批标准动作：

| Action | Meaning |
| --- | --- |
| `wait_for_ready` | 等待 scenario host、runtime 和 projection 进入稳定状态 |
| `wait_for_idle` | 等待 runtime transaction / motion / pending operation 清空 |
| `scroll_to_history_top` | 模拟用户向历史方向滚动到触发 before edge |
| `scroll_to_middle` | 模拟用户离开底部阅读历史 |
| `scroll_to_bottom` | 用户滚动到底部 |
| `append_message` | 通过 demo policy 追加一条消息 |
| `prepend_history` | 通过 demo policy 加载历史 |
| `follow_bottom` | 点击或 dispatch follow bottom 语义动作 |
| `jump_to_quoted_message` | 点击当前可见 quote，触发 destination jump |
| `switch_feed` | 切换 active feed |
| `toggle_dynamic_height` | 打开/关闭动态高度 |
| `toggle_event_storm` | 打开/关闭 Event Storm |
| `collect_evidence` | 采集 evidence checkpoint |

## 5. Action Result

```ts
type E2EActionResult = {
  ok: boolean
  actionId: string
  message: string
  before?: E2EEvidence
  after?: E2EEvidence
  error?: {
    code: string
    details?: Record<string, unknown>
  }
}
```

失败时必须返回结构化错误，不能只抛字符串。

## 6. Semantic DOM Contract

即使有 global bridge，DOM 仍要对 AI 和人工友好：

| Element | Required attributes |
| --- | --- |
| viewport root | `data-testid="message-viewport"`, `data-ai-region="message-list"` |
| scroll container | `data-testid="message-scroll-container"` |
| row | `data-message-row`, `data-message-id`, `data-ai-role="message-row"` |
| quote button | `data-testid="quote-jump-..."`, `data-ai-action="jump-to-quote"` |
| follow button | `aria-label="Follow latest messages"`, `data-ai-action="follow-bottom"` |
| feed button | `data-feed-id`, `data-ai-action="switch-feed"` |
| AI status panel | `role="status"`, `data-testid="e2e-ai-status"` |

语义属性必须稳定，不应绑定样式类名。

## 7. AI Status Region

页面应提供可见或半隐藏的 AI 状态区域：

```html
<section
  role="status"
  aria-live="polite"
  data-testid="e2e-ai-status"
>
  Scenario: paging.prepend-anchor-preservation
  Runtime: READY / IDLE
  Feed: support / generation 1 / revision 12
  Visible: m-120..m-136
  Bottom lock: UNLOCKED
</section>
```

这让 Browser Use 这类基于页面状态的 agent 即使不调用 bridge，也能读到当前上下文。

## 8. Agent Rules

AI agent 执行 e2e 时必须遵守：

1. 先调用或读取 `getState()`。
2. 只执行 `listActions()` 中 enabled 的动作，除非任务明确要求探索。
3. 每个关键动作后调用 `wait_for_idle`。
4. 每个断言前调用 `collect_evidence`。
5. 失败时保存 evidence，不凭主观视觉描述下结论。
6. 如果 evidence 不足，报告缺失字段，而不是猜测 root cause。

## 9. Browser Use / Chrome DevTools MCP Mapping

| Need | Preferred primitive |
| --- | --- |
| open scenario | navigate to `/e2e?scenario=...` |
| inspect current state | evaluate `window.__X_MESSAGE_LIST_E2E__.getState()` |
| perform stable action | evaluate `runAction(actionId, payload)` |
| operate like user | click by role / test id / data-ai-action |
| collect failure evidence | evaluate `getEvidence()`, screenshot, console logs |
| performance investigation | Chrome DevTools trace / performance tools |

这个 mapping 让同一套场景可以被 Codex App、Browser Use、本地脚本或人工调试复用。

