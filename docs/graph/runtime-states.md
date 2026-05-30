# Runtime States

Runtime 是多条状态轴；不要把这些图合并成一个大状态机。

## Viewport Phase

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle: IDLE
  Projecting: PROJECTING
  Measuring: MEASURING
  Correcting: CORRECTING

  Idle --> Projecting: accepted LoadedSegment
  Projecting --> Measuring: matching ProjectionCommitAck
  Projecting --> Idle: commit timeout emits viewportError
  Measuring --> Measuring: first pass waits for missing anchor ref
  Measuring --> Correcting: DOM can be evaluated
  Correcting --> Idle: correction, settle, events emitted

  Idle --> Measuring: resize observer rAF
  Measuring --> Correcting: resize measurement complete
```

`settling` 是 internal transaction axis state，不是 public `viewportPhase`。`MOTION` 是当前 contract 保留值；现有 controller 不会 emit，所以不作为真实运行节点绘制。当前实现已预留 internal motion slot，但仍是 no-op，不改变 snapshot phase 或事件。

## Edge Slot State

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle: idle
  Loading: loading
  Error: error
  Exhausted: exhausted

  Idle --> Loading: startEdgeNeed with hasMore, IDLE phase, no pendingIntent
  Loading --> Idle: matching extend segment and hasMore remains
  Loading --> Exhausted: matching extend segment and edge exhausted
  Loading --> Error: reportEdgeRequestFailure with matching token
  Error --> Loading: retryEdgeRequest
  Exhausted --> Idle: trim-before or trim-after clears matching edge
  Loading --> Idle: reset or generation reset clears latch
  Error --> Idle: reset or generation reset clears latch
  Exhausted --> Idle: reset clears latch
```

## Pending Intent Arbitration

```mermaid
stateDiagram-v2
  [*] --> ReadyIdle
  ReadyIdle: IDLE phase, no pendingIntent
  EdgePending: pendingIntent=edge-before or edge-after
  UnderflowPending: pendingIntent=underflow-fill
  FollowBottomPending: pendingIntent=follow-bottom
  DestinationPending: pendingIntent=destination

  ReadyIdle --> EdgePending: edge trigger intersects with user or momentum source
  ReadyIdle --> UnderflowPending: post-commit underflow fillable edge
  ReadyIdle --> FollowBottomPending: scrollToLatest with hasMoreAfter
  ReadyIdle --> ReadyIdle: scrollToLatest with no hasMoreAfter writes native bottom and LOCKED
  ReadyIdle --> DestinationPending: scrollToMessage or restoreToMessage target outside segment
  ReadyIdle --> ReadyIdle: local destination align emits destinationSettled

  EdgePending --> ReadyIdle: matching extend segment settles
  EdgePending --> ReadyIdle: matching failure or generation reset
  UnderflowPending --> ReadyIdle: one fill segment settles
  ReadyIdle --> UnderflowPending: re-evaluation still sees underflow
  FollowBottomPending --> FollowBottomPending: reset-latest settles with hasMoreAfter
  FollowBottomPending --> ReadyIdle: reset-latest settles with no hasMoreAfter and LOCKED
  FollowBottomPending --> ReadyIdle: user scroll, destination, or generation reset interrupts
  DestinationPending --> ReadyIdle: reset-around settles
  DestinationPending --> ReadyIdle: new generation or follow-bottom clears destination
```
