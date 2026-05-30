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
  Motion: MOTION

  Idle --> Projecting: accepted LoadedSegment
  Projecting --> Measuring: matching ProjectionCommitAck
  Projecting --> Idle: commit timeout emits viewportError
  Measuring --> Measuring: first pass waits for missing anchor ref
  Measuring --> Correcting: DOM can be evaluated
  Correcting --> Idle: instant correction, settle, events emitted
  Correcting --> Motion: settle resolves bounded JS motion
  Idle --> Motion: local jump or follow-bottom can resolve in current segment
  Motion --> Idle: motion settle emits observation and destination if needed
  Motion --> Idle: user input or detach cancels motion
  Motion --> Projecting: accepted LoadedSegment supersedes motion

  Idle --> Measuring: resize observer rAF
  Measuring --> Correcting: resize measurement complete
```

`settling` 是 internal transaction axis state，不是 public `viewportPhase`。`MOTION` 只表示 runtime 自管的 bounded JS scroll motion；reduced-motion 或 epsilon target 可以同步 settle 回 `IDLE`。

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
  ReadyIdle --> ReadyIdle: scrollToLatest with no hasMoreAfter starts follow-bottom motion and locks on settle
  ReadyIdle --> DestinationPending: scrollToMessage or restoreToMessage target outside segment
  ReadyIdle --> ReadyIdle: local destination jump starts motion and emits destinationSettled on settle

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
