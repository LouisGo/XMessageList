# Evidence And Oracles

## 1. Principle

AI 可以观察和操作页面，但最终判断必须由 evidence + deterministic oracle 完成。

每个场景必须回答三个问题：

1. 用户行为是否正确。
2. runtime 状态机是否回到稳定状态。
3. 如果失败，证据能否定位到 demo policy、React projection、runtime、browser timing 或 harness。

## 2. Evidence Schema

```ts
type E2EEvidence = {
  schemaVersion: 1
  scenarioId: string
  checkpointId: string
  timestamp: number
  feed: FeedEvidence
  runtime: RuntimeEvidence
  viewport: ViewportEvidence
  anchors: AnchorEvidence
  ui: UiEvidence
  events: EventEvidence
  diagnostics: DiagnosticEvidence
  console: ConsoleEvidence
  artifacts?: ArtifactEvidence
}
```

## 3. Feed Evidence

```ts
type FeedEvidence = {
  activeFeedId: string
  generation: number
  dataRevision: number
  projectionRevision: number
  messageCount: number
  loadedMessageCount: number
  hasMoreBefore: boolean
  hasMoreAfter: boolean
}
```

## 4. Runtime Evidence

```ts
type RuntimeEvidence = {
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
```

## 5. Viewport Evidence

```ts
type ViewportEvidence = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  distanceToBottom: number
  topSpacer: number
  bottomSpacer: number
  renderedRows: number
  visibleRows: Array<{
    messageId: string
    serializedKey: string
    itemKind: 'committed' | 'optimistic' | 'tombstone'
    optimisticStatus?: 'sending' | 'failed'
    top: number
    bottom: number
    height: number
  }>
}
```

Visible rows 必须基于真实 DOM rect 和 viewport intersection 计算，不能只读 projection items。
`itemKind` / `optimisticStatus` 必须从 runtime snapshot 派生，不新增 DOM 属性。

## 6. Anchor Evidence

```ts
type AnchorEvidence = {
  current: {
    messageId: string
    serializedKey: string
    offsetWithinMessage: number
    top: number
  } | null
  before?: {
    messageId: string
    top: number
  }
  after?: {
    messageId: string
    top: number
  }
  deltaPx?: number
}
```

Anchor preservation 类场景必须同时记录 before / after / delta。

## 7. Event Evidence

```ts
type EventEvidence = {
  viewportAnchorChanged: Array<{
    reason: string
    messageId: string | null
    offsetWithinMessage: number | null
  }>
  needMoreBefore: number
  needMoreAfter: number
  needMessagesAround: Array<{
    reason: string
    messageId: string
    position?: number
  }>
  destinationSettled: Array<{
    intent: string
    resolution?: string
    targetMessageId?: string
    resolvedMessageId?: string
  }>
  viewportErrors: string[]
}
```

## 8. Diagnostic Evidence

保留最近 N 条 runtime diagnostic，默认 N=80：

```ts
type DiagnosticEvidence = {
  recent: Array<{
    channel: string
    severity: string
    name: string
    correlationId?: string
    details: Record<string, unknown>
  }>
}
```

必须优先保留以下名称：

- `projection.publish`
- `transaction`
- `correction.anchorPreserved`
- `measurement.readiness`
- `destinationMotion.start`
- `destinationMotion.settle`
- `destinationMotion.cancel`
- `data.setSnapshot`
- `data.windowBudgetExceeded`

## 9. Console Evidence

```ts
type ConsoleEvidence = {
  errors: Array<{ text: string; location?: string }>
  warnings: Array<{ text: string; location?: string }>
}
```

任何 console error 默认使 P0/P1 场景失败，除非场景显式声明允许。

## 10. Standard Oracles

### 10.1 Runtime Idle

```ts
expectRuntimeIdle(evidence)
```

要求：

- `runtime.state` 是 `READY` 或 `READY_EMPTY`。
- `runtime.transactionState === 'idle'`。
- `runtime.destinationState` 是 `idle` 或 `settled`。
- `runtime.motionActive === false`。
- `runtime.pendingCommands === 0`。

### 10.2 Anchor Preserved

```ts
expectAnchorPreserved(before, after, { tolerancePx: 1 })
```

要求：

- before anchor message 仍可见。
- after anchor message id 与 before 一致，除非场景允许 deleted fallback。
- `Math.abs(deltaPx) <= tolerancePx`。
- 无异常 `viewportError`。

### 10.3 Bottom Locked

```ts
expectBottomLocked(evidence, { thresholdPx })
```

要求：

- `bottomLockState === 'LOCKED'`。
- `distanceToBottom <= thresholdPx`。
- follow-bottom button 不应可见。

### 10.4 User Reading Is Not Stolen

```ts
expectNoFollowWhenUserReading(before, after)
```

要求：

- 用户离开底部后 append 不应把 viewport 拉到底。
- before anchor 仍可见或 after first visible message 与 before 接近。
- `bottomLockState === 'UNLOCKED'`。

### 10.5 Destination Settled On Target

```ts
expectDestinationSettledOnTarget(evidence, targetMessageId)
```

要求：

- target row 可见。
- `destinationSettled` 出现且 target / resolved target 合理。
- highlight message id 与 resolved target 一致。
- runtime 回到 idle。

### 10.6 No Feed Pollution

```ts
expectNoFeedPollution(beforeSwitch, afterSwitch)
```

要求：

- active feed id 正确。
- visible rows 全部属于 active feed。
- bottom lock / pending operation 没有从旧 feed 泄漏。
- stale ResizeObserver / commit ack 没有产生新 feed error。

## 11. Failure Report

失败报告必须使用统一格式：

```md
# E2E Failure

Scenario: paging.prepend-anchor-preservation
Checkpoint: after_prepend_idle
Primary owner: runtime state machine

## Summary
Anchor m-120 moved by 18px after prepend.

## Evidence
- before anchor top: 184
- after anchor top: 202
- delta: 18
- transaction: prepend-42 completed
- correction diagnostic: missing

## Missing Evidence
None

## Shortest Repro
1. open /e2e?scenario=paging.prepend-anchor-preservation
2. run action scroll_to_history_top
3. run action wait_for_idle
4. collect evidence

## Attachments
- evidence.json
- screenshot.png
- console.json
```

## 12. Evidence Storage

建议后续输出到：

```text
.logs/e2e/
  <timestamp>-<scenario-id>/
    evidence.before.json
    evidence.after.json
    console.json
    screenshot.png
    report.md
```

`.logs/` 不进入 git。
