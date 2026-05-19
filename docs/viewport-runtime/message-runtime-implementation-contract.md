# Message Runtime 实现合同

本文定义从零实现 physical segment viewport runtime 时必须固定的外部合同。

## 1. Public API

```ts
class MessageViewportRuntime {
  attach(container: HTMLElement): void;
  detach(): void;
  destroy(): void;

  setDataSnapshot(snapshot: MessageDataSnapshot): void;
  dispatch(command: MessageRuntimeCommand): void;

  subscribe(listener: RuntimeListener): () => void;
  getSnapshot(): MessageViewportSnapshot;

  subscribeEvent(listener: RuntimeEventListener): () => void;
  getViewportAnchorState(): AnchorState | null;

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void;
  registerTopSpacer(element: HTMLElement | null): void;
  registerBottomSpacer(element: HTMLElement | null): void;
  registerTopSentinel(element: HTMLElement | null): void;
  registerBottomSentinel(element: HTMLElement | null): void;

  notifyProjectionCommitted(commit: ProjectionCommitToken): void;

  getPhysicalScrollMetrics(): PhysicalScrollMetrics;
  subscribePhysicalScroll(listener: RuntimeListener): () => void;
  beginDirectScroll(input: DirectScrollInput): void;
  writeDirectScrollTop(scrollTop: number, input: DirectScrollInput): boolean;
  endDirectScroll(input: DirectScrollInput): void;

  getDiagnosticRecords(): ViewportDiagnosticRecord[];
}
```

业务层不直接写 `scrollTop`。标准 React adapter 可以使用 direct-scroll API 实现 custom scrollbar。

## 2. Projection Snapshot

Projection snapshot 只驱动 React rows / spacers / slots。

```ts
type MessageViewportSnapshot = {
  feedId: string;
  generation: number;
  revision: number;
  commitToken: ProjectionCommitToken;
  items: MessageDataItem[];
  renderWindow: RenderWindow;
  topSpacer: number;
  bottomSpacer: number;
  bottomLockState: BottomLockState;
  bootstrapState: BootstrapState;
  viewportPhase: ViewportPhase;
  edgeState: ViewportEdgeState;
};
```

`physicalSegmentId` 不作为 React 渲染状态使用，但必须通过 `commitToken` 进入 projection snapshot metadata，供 commit ack 原样回传。`scrollTop` 和 thumb geometry 不进 projection snapshot，它们进入 physical metrics / diagnostics。

`snapshot.revision` 必须与 `snapshot.commitToken.projectionRevision` 保持同值。

## 3. Physical Metrics

```ts
type PhysicalScrollMetrics = {
  physicalSegmentId: string | null;
  physicalSegmentRevision: number;
  viewportSize: number;
  physicalWindowSize: number;
  domScrollHeight: number;
  scrollPosition: number;
  maxScrollPosition: number;
  scrollHeightCap: number;
  capMode: 'normal' | 'short-feed' | 'exceptional-row';
  safeScrollRangeStart: number;
  safeScrollRangeEnd: number;
  isDragLocked: boolean;
  isThumbFrozen: boolean;
  isSegmentShiftPending: boolean;
  pendingShiftDirection: 'before' | 'after' | null;
  pendingEdgeOverflowPx: number;
  isSegmentShifting: boolean;
  isMomentumLatched: boolean;
  suppressedMomentumDeltaPx: number;
  segmentRelayoutState: 'idle' | 'pending' | 'running';
  segmentRelayoutReason: SegmentRelayoutReason | null;
  adjacentPrefetchBefore: 'idle' | 'needed' | 'in-flight' | 'ready';
  adjacentPrefetchAfter: 'idle' | 'needed' | 'in-flight' | 'ready';
};
```

`SegmentRelayoutReason` 使用主规范 [physical-segment-architecture.md](./physical-segment-architecture.md) 中的枚举。

更新触发：

- scroll frame
- segment shift / relayout
- resize
- direct drag begin/end
- motion start/settle/cancel

Projection snapshot revision 不应因为普通 scroll frame 递增。

稳定帧中：

```text
physicalWindowSize === domScrollHeight
maxScrollPosition === max(0, physicalWindowSize - viewportSize)
```

Custom scrollbar 必须使用这组 metrics，不能直接从 DataWindow 或裸 DOM 推导 thumb geometry。

## 4. Commands

```ts
type MessageRuntimeCommand =
  | { type: 'bootstrap'; mode: 'latest' | 'unread' | 'restored'; target?: AnchorState | MessageIdentityAnchor }
  | { type: 'jump'; target: MessageIdentityAnchor; origin?: MessageIdentityAnchor }
  | { type: 'restore'; target: AnchorState | MessageIdentityAnchor }
  | { type: 'followBottom' }
  | { type: 'reset'; reason: string };
```

Command 只表达语义目的地。它不能携带物理 scrollTop。

## 5. Data Revision Handling

`MessageDataSnapshot.change.viewportModifier` 是数据变化语义，不是几何事务名。

| Modifier | New response |
| --- | --- |
| `prepend` | update DataWindow; satisfy pending shift-before or relayout active segment if needed |
| `append` | update DataWindow; refresh active segment or latest follow intent |
| `auto-scroll-to-bottom` | ensure latest segment and follow bottom |
| `items-change` | refresh active segment or relayout if measurement/coverage invalid |
| `reset` | reset physical segment and bootstrap |
| `none` | store data, no geometry mutation unless pending intent consumes it |

Reserved modifiers must still error until a dedicated transaction exists.

## 6. Transaction Kinds

```ts
type ViewportTransactionKind =
  | 'bootstrap'
  | 'segmentShift'
  | 'segmentRelayout'
  | 'projectionRefresh'
  | 'followBottom'
  | 'jump'
  | 'restore'
  | 'reset';
```

`prepend` and `append` are no longer physical transaction kinds.

`segmentRelayout` is a required transaction kind, not an implementation option.

## 7. Commit Contract

```ts
type ProjectionCommitToken = {
  feedId: string;
  generation: number;
  projectionRevision: number;
  segmentId: string;
  segmentRevision: number;
  transactionId: string;
};

type ProjectionCommit = ProjectionCommitToken;
```

Runtime sequence:

```text
publish projection with ProjectionCommitToken
-> React commit ack echoes the same ProjectionCommitToken
-> runtime synchronous measurement
-> runtime correction / rebase
-> runtime promotes pending physical metrics
```

No measurement before commit ack. No pending `segmentRevision` may appear in committed physical metrics before its token is acknowledged.

## 8. Bottom Lock Contract

```ts
type BottomLockState = 'LOCKED' | 'UNLOCKED';
```

`LOCKED` requires all conditions:

- active segment role is `latest`
- `hasMoreAfter === false`
- distance to latest segment physical bottom is within lock threshold
- no segment shift / destination pending

Current physical bottom alone is insufficient.

## 9. Diagnostics Contract

Runtime diagnostics must expose physical geometry:

```ts
type ViewportDiagnostics = {
  ts: number;
  physicalSegmentId: string | null;
  physicalSegmentRevision: number;
  renderWindowStart: MessageRuntimeItemKey | null;
  renderWindowEnd: MessageRuntimeItemKey | null;
  topSpacer: number;
  bottomSpacer: number;
  mountedRowsHeight: number;
  scrollTop: number;
  scrollHeight: number;
  domScrollHeight: number;
  clientHeight: number;
  physicalWindowHeight: number;
  maxScrollPosition: number;
  scrollHeightCap: number;
  capMode: 'normal' | 'short-feed' | 'exceptional-row';
  safeScrollRangeStart: number;
  safeScrollRangeEnd: number;
  realRowCoveragePx: number;
  minRealRowCoveragePx: number;
  isDragLocked: boolean;
  isThumbFrozen: boolean;
  isSegmentShiftPending: boolean;
  pendingShiftDirection: 'before' | 'after' | null;
  pendingEdgeOverflowPx: number;
  isSegmentShifting: boolean;
  isMomentumLatched: boolean;
  suppressedMomentumDeltaPx: number;
  segmentRelayoutState: 'idle' | 'pending' | 'running';
  segmentRelayoutReason: SegmentRelayoutReason | null;
  adjacentPrefetchBefore: 'idle' | 'needed' | 'in-flight' | 'ready';
  adjacentPrefetchAfter: 'idle' | 'needed' | 'in-flight' | 'ready';
  bottomLockState: BottomLockState;
  viewportPhase: ViewportPhase;
  dataRevision: number;
};
```

At minimum, diagnostics must detect:

- scrollHeight cap exceeded
- spacer-only viewport
- real-row coverage insufficient
- same-revision spacer oscillation
- segment shift loop
- thumb geometry coupled to data size
- drag lock stolen by another writer
- pending segmentRevision exposed before commit token ack
- momentum residual causing shift loop

## 10. Performance Budget

Performance budgets validate implementation. They do not justify changing architecture.

Required properties:

- scroll frame does not rerender row tree
- segment shift commits target rows and spacers in one projection
- no unbounded spacer growth with data count
- no custom scrollbar geometry recomputation from DataWindow length
