# runtime-next 容器内核架构

本文定义 runtime-next 的容器内核边界。主 ownership 文档见 [runtime-next-architecture.md](./runtime-next-architecture.md)，几何主规范见 [physical-segment-architecture.md](./physical-segment-architecture.md)。

本文中的模块名是 runtime-next 的目标职责切分，不是旧 `src/runtime.deprecated` 目录结构的迁移清单。旧实现不能作为本文模块的源码来源。

## 1. Scope

Runtime-next 是 renderer 内部的 imperative viewport engine。它通过 physical geometry layer 拥有滚动几何、DOM window、measurement、transaction、anchor、bottom lock 和 diagnostics。

React 只渲染 projection，不拥有 geometry。

## 2. Public Surface

推荐核心对象：

```ts
class MessageViewportRuntime {
  attach(container: HTMLElement): void;
  detach(): void;
  destroy(): void;

  setDataSnapshot(snapshot: MessageDataSnapshot): void;
  dispatch(command: MessageRuntimeCommand): void;

  subscribe(listener: RuntimeListener): () => void;
  subscribeEvent(listener: RuntimeEventListener): () => void;
  getSnapshot(): MessageViewportSnapshot;
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
}
```

`getPhysicalScrollMetrics` 和 `subscribePhysicalScroll` 面向标准 React adapter / custom scrollbar，不是业务 app 的滚动控制入口。业务层仍然只发 semantic command。

`beginDirectScroll` / `writeDirectScrollTop` / `endDirectScroll` 在 custom scrollbar drag 中组成一个 pointer-owned drag session。active `DragSegmentHandoff` 期间，runtime 可以临时拒绝旧 segment direct write 并通过 physical metrics 发布 handoff / freeze 状态；React adapter 不应结束 pointer capture。

## 3. Internal Modules

| Module | Responsibility |
| --- | --- |
| `MessageViewportRuntimeController` | 组合 runtime parts，维护 lifecycle 和状态轴。 |
| `RuntimeDataSnapshotCoordinator` | 接收 DataWindow revision，只更新数据真相，不直接修改物理滚动空间。 |
| `PhysicalSegmentCoordinator` | 选择 active segment，维护 `segmentId / segmentRevision / logicalSegmentId / physicalWindowHeight`。 |
| `RenderWindowEngine` | 在 active segment 预算内选择 mounted rows。 |
| `SpacerEngine` | 计算当前 segment 内 local top/bottom spacer。禁止计算全局累计 spacer。 |
| `ProjectionCoordinator` | 发布 `items + renderWindow + local spacers + ProjectionCommitToken`。 |
| `CommitCoordinator` | 等待并校验 React commit token ack。 |
| `MeasurementEngine` | 测量 mounted rows，产出 local correction 或 segment relayout intent。 |
| `ScrollGeometryCoordinator` | 计算 physical scroll metrics、custom scrollbar thumb 输入和 cap diagnostics。 |
| `ScrollIntentEngine` | 分类 user / wheel / keyboard / momentum / programmatic / recovery / followBottom / jump / drag 输入。 |
| `DirectScrollCoordinator` | custom scrollbar drag / track 的写入仲裁，维护 `isDragLocked`，并协调 active drag handoff。 |
| `MomentumLatchCoordinator` | trackpad / wheel 边界残余 delta 抑制，维护 `isMomentumLatched`。 |
| `SegmentTransactionController` | 执行 `SegmentShift` 和 `SegmentRelayout`。 |
| `ViewportTransactionController` | 执行 bootstrap、jump、restore、followBottom、reset 等语义事务。 |
| `ScrollMotionEngine` | 只在目标 segment 内做 bounded motion。 |
| `EdgeNeedCoordinator` | 用 data revision + physical segment revision 共同 latch edge need，并维护 adjacent segment prefetch 状态。 |
| `DiagnosticRecorder` | 检测 physical invariant 违约并输出恢复线索。 |

## 4. Snapshot Boundary

Projection snapshot 只回答“React 应渲染什么”。

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

不进入 projection snapshot：

- `scrollTop`
- `scrollHeight`
- row rects
- height cache map
- transaction queue
- command queue
- `isDragLocked`
- `physicalSegmentId` as React render state
- custom scrollbar thumb geometry

`commitToken` 是 commit ack metadata。React adapter 必须原样回传它，但不能用它推导 thumb geometry 或业务滚动状态。

`snapshot.revision === snapshot.commitToken.projectionRevision` 必须成立。

这些进入 physical metrics 或 diagnostics：

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

原因：projection snapshot 不能因每一帧 `scrollTop` 变化而触发 React row tree rerender。Custom scrollbar 可以订阅 physical metrics，message projection 订阅 projection snapshot。

稳定帧中：

```text
physicalWindowSize === domScrollHeight
maxScrollPosition === max(0, physicalWindowSize - viewportSize)
```

如果这两个等式不成立，runtime 必须输出 diagnostics，而不是让 custom scrollbar 自行兜底。

## 5. DOM Contract

DOM 仍是正常文档流：

```html
<div data-message-scroll-container>
  <div data-top-sentinel></div>
  <div data-top-spacer style="height: ...px"></div>
  <div data-message-window>
    <div data-message-row="..."></div>
  </div>
  <div data-bottom-spacer style="height: ...px"></div>
  <div data-bottom-sentinel></div>
</div>
```

约束：

- native scrollbar 隐藏，但 container 仍是唯一 scroll container。
- row 必须在正常文档流中。
- spacer 只能是 active segment 的 local spacer。
- `topSpacer + mountedRowsHeight + bottomSpacer === physicalWindowHeight`。
- `physicalWindowHeight` 在同一 `segmentRevision` 内冻结。
- `physicalWindowHeight` 默认必须小于等于 configured cap；`capMode='exceptional-row'` 例外但必须诊断。
- `overflow-anchor: none` 放在 scroll container 或 window 根节点。
- row key 使用 `MessageRuntimeItemKey`，不使用 render index。

## 6. State Axes

Lifecycle：

```ts
type RuntimeState =
  | 'INITIAL'
  | 'ATTACHED'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'DETACHED'
  | 'DESTROYED';
```

READY 子状态：

```ts
type ReadySubstate =
  | 'READY_IDLE'
  | 'READY_FOLLOW_BOTTOM_PENDING'
  | 'READY_DESTINATION_PENDING'
  | 'READY_SEGMENT_SHIFT_PENDING'
  | 'READY_SEGMENT_SHIFTING'
  | 'READY_MOTION_ACTIVE';
```

Viewport phase：

```ts
type ViewportPhase =
  | 'IDLE'
  | 'RECOVERING'
  | 'SEGMENT_SHIFTING'
  | 'DESTINATION_PENDING'
  | 'MOTION_ACTIVE';
```

`BottomLockState` 只表达 feed latest lock：

```ts
type BottomLockState = 'LOCKED' | 'UNLOCKED';
```

`isDragLocked` 独立存在。它不能塞进 bottom lock，也不能用 `MOTION_ACTIVE` 代替。

## 7. Ownership Rules

- Data revision 到达只能改变 DataWindow。它不能直接扩张 scrollHeight。
- Segment shift 消费 DataWindow 结果，负责改变 physical geometry。
- Resize / measurement 只能触发 local correction 或 segment relayout，不能隐式跨 segment。
- Motion 不能跨不存在的全局高度。远距离 jump / restore 先选 target segment。
- Edge need 不能只看 sentinels。必须检查 active segment 是否已经在对应 data edge。
- Diagnostics 不是 debug 附件。它是 invariant enforcement surface。

## 8. Recovery Principles

生产路径不 hard fail，但必须可恢复：

| Violation | Recovery |
| --- | --- |
| spacer-only viewport | anchor-based segment relayout |
| scrollHeight cap exceeded | reduce mounted rows or exceptional cap |
| segment shift loop | suppress next shift and rebase to safe zone |
| same-revision spacer oscillation | freeze local correction, run one relayout |
| stale data for pending shift | remain `READY_SEGMENT_SHIFT_PENDING` |

开发和测试环境可以对 architecture error hard assert。
