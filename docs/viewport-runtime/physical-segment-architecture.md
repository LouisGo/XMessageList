# Physical Segment Viewport Architecture

本文是 runtime-next 的几何主规范。它只定义 Physical Segment Windowing 的几何真相，不描述如何在旧 `src/runtime` 上增量修补。

后续重构以 [runtime-next-architecture.md](./runtime-next-architecture.md) 的 ownership 边界和本文的几何不变量为准。旧 runtime 必须作为 `runtime.deprecated` 参考隔离，不再作为新架构承载体。

不再沿用“已加载 DataWindow 连续暴露成单一 scrollHeight”的设计。

## 1. Core Decision

消息列表的物理滚动空间必须和已加载数据总量解耦。

```text
DataWindow owns message availability.
PhysicalSegment owns scroll geometry.
SegmentShift is the only bridge between them.
```

旧模型把 `topSpacer + mountedRows + bottomSpacer` 当成已加载数据的累计高度。新模型只允许它表示当前 physical segment 的局部几何预算。

## 2. Terms

| Term | Meaning |
| --- | --- |
| `DataWindow` | renderer 当前可用的数据集合。它可以比当前屏幕大很多，但不直接决定 `scrollHeight`。 |
| `PhysicalSegment` | runtime 当前暴露给 scroll container 的局部物理段。它包含一段 DataWindow item range、局部 spacers 和物理高度预算。 |
| `activeSegment` | 当前挂载并参与滚动的 physical segment。 |
| `segmentRevision` | physical segment 几何版本。shift、relayout、cap fallback 都必须在发布新 projection 前分配下一 revision。 |
| `committedPhysicalWindowHeight` | 某个 `segmentRevision` 发布后固定的物理窗口高度。measurement delta 不能直接改变它。本文后续简称 `physicalWindowHeight`。 |
| `logicalSegment` | segment shift 的不可见边界单元。relayout 只能在同一个 logical segment bounds 内重排 render window。 |
| `SegmentShift` | 从当前 physical segment 原子切换到相邻或目标 segment 的事务。 |
| `SegmentRelayout` | 不跨 logical segment，只因 resize / measurement 重新裁剪当前 segment 的事务。 |
| `CustomScrollbar` | 隐藏 native scrollbar 后的唯一 thumb 几何层。thumb 只反映 physical segment 内的位置。 |
| `DragLock` | custom scrollbar drag session 的独立锁。它阻止无关 writer 抢写，但允许 runtime 在同一 drag session 内执行受控跨段 handoff。 |
| `DragSegmentHandoff` | custom scrollbar thumb 仍按住时，由 runtime 接管的跨段 `SegmentShift`。它 freeze thumb、commit target segment、rebase 到 continuation band，并继续同一次 pointer drag。 |

推荐内部模型：

```ts
type PhysicalSegment = {
  segmentId: string;
  segmentRevision: number;
  logicalSegmentId: string;
  logicalAnchorKey: MessageRuntimeItemKey;
  logicalStartItemKey: MessageRuntimeItemKey;
  logicalEndItemKey: MessageRuntimeItemKey;
  renderWindowStartKey: MessageRuntimeItemKey;
  renderWindowEndKey: MessageRuntimeItemKey;
  logicalRole: 'history' | 'latest' | 'target' | 'short-feed';
  estimatedRowsHeight: number;
  physicalWindowHeight: number;
  scrollHeightCap: number;
  capMode: 'normal' | 'short-feed' | 'exceptional-row';
};
```

`segmentId` 不应该用数组 index。它必须能在 diagnostics 中稳定追踪一次 shift / relayout 前后的变化。

`logicalStartItemKey` / `logicalEndItemKey` 是 relayout 的硬边界。`renderWindowStartKey` / `renderWindowEndKey` 可以在 relayout 中变化，但不能越过 logical bounds；越界必须变成 `SegmentShift` 或 target segment rebuild。

### 2.1 Segment Revision Lifecycle

`segmentRevision` 的时点必须唯一：

```text
compute next physical geometry
-> allocate nextSegmentRevision
-> publish projection with ProjectionCommitToken(nextSegmentRevision)
-> commit / measure / rebase all reference the acknowledged token
-> if transaction aborts, restore previous stable revision
```

禁止在 commit + measure 之后再补增 revision。否则 edge latch、diagnostics、custom scrollbar metrics 会在同一次几何切换里看到两个版本。

### 2.2 Projection Commit Token

projection publish 和 React commit ack 必须共享同一个 token：

```ts
type ProjectionCommitToken = {
  feedId: string;
  generation: number;
  projectionRevision: number;
  segmentId: string;
  segmentRevision: number;
  transactionId: string;
};
```

规则：

1. publish projection 时，必须把 `ProjectionCommitToken` 一起发布给 React adapter。
2. React commit ack 必须原样回传该 token。
3. `projectionRevision` 必须等于 projection snapshot 的 `revision`。
4. runtime 只在 token 完全匹配时，才把 pending segment promotion 为 committed metrics。
5. commit ack 不能只证明 render 成功，必须证明具体的 `segmentRevision` 已经落 DOM。
6. ack 之前 custom scrollbar 继续使用上一稳定帧的 committed metrics，不得提前采纳 pending geometry。

### 2.3 Adjacent Segment Prefetch Band

无感切换不能等用户撞到边界后才开始准备相邻 segment。Runtime 必须在进入 shift trigger band 之前，提前把相邻 segment 的数据需求和 layout 需求标记为预取态。

```text
safe scroll range
-> prefetch band
-> shift trigger band
```

规则：

- 进入 prefetch band 时，runtime 预先发起 `needMoreBefore` / `needMoreAfter` / `needMessagesAround`，但不改变当前 segment。
- target 数据到达时只补齐相邻 segment 构建所需的数据，不触发旧式连续窗口恢复。
- 真正的 `SegmentShift` 到达触发带时，目标 segment 必须尽量已可构建。
- 如果 prefetch 失败，用户仍可继续滚动，但 diagnostics 必须记录 `adjacentPrefetchBefore/After = 'needed'` 或 `'in-flight'`。

Prefetch 是 data readiness，不是 geometry mutation。它禁止：

- 改变 `activeSegment` / `segmentRevision` / `physicalWindowHeight`
- 改变 current projection rows / spacers / render window
- 发布新的 committed physical metrics
- 根据相邻数据提前移动 `scrollTop`

## 3. Hard Invariants

这些是不变量，不是优化目标。

1. `scrollHeight` 不随已加载数据总量增长。
2. 同一 `segmentRevision` 内 `physicalWindowHeight` 冻结。measurement / ResizeObserver delta 不能直接改变 thumb 基线。
3. 稳定帧中必须满足 `physicalWindowHeight === domScrollHeight`。
4. 稳定帧中 normal / exceptional-row 模式必须满足 `topSpacer + mountedRowsHeight + bottomSpacer === physicalWindowHeight`。short-feed 模式必须满足 `topSpacer + mountedRowsHeight + bottomSpacer + naturalBlankHeight === physicalWindowHeight`，且 `naturalBlankHeight` 不能被当成 top/bottom spacer。如果 measurement delta 改变 mounted rows height，local spacer correction 必须反向吸收 delta 以守恒总高度；short-feed 内容高度变化默认进入 relayout。
5. 稳定帧中必须满足 `maxScrollPosition === max(0, physicalWindowHeight - clientHeight)`。
6. `scrollHeightCap` 是 normal cap。`capMode === 'exceptional-row'` 时 `physicalWindowHeight` 可以超过它，但必须带 diagnostic 和 recovery plan。
7. `topSpacer` 和 `bottomSpacer` 只表达当前 physical segment 内的 local blank budget，不表达 DataWindow 中未挂载历史的累计高度。
8. safe scroll range 内 viewport 必须满足真实 row coverage 下限，不能只和一条 row 边缘相交。
9. custom scrollbar thumb size 只依赖 viewport size 和 committed physical window size，不依赖 DataWindow item count。
10. custom scrollbar drag 在单个 committed physical segment 内必须线性映射到该 segment 的 `scrollTop`。跨段 handoff 后重新绑定到新的 committed segment，禁止按数据总量额外缩放用户输入。
11. drag 期间允许 runtime 执行受控 `DragSegmentHandoff`：它必须复用 `SegmentShift` transaction、保留 pointer capture、冻结 thumb、commit 后把 `scrollTop` rebase 到新 segment 的 drag continuation band。禁止在 pointermove / React adapter 中直接替换 rows 或 spacer。
12. `SegmentShift` 和 `SegmentRelayout` 必须是事务。禁止在 scroll handler 中直接替换 rows。
13. `BottomLockState.LOCKED` 只有在 active segment 是 latest segment 且 `hasMoreAfter === false` 时才可能成立。
14. 任一时刻只能有一个 `scrollTop` writer。drag、motion、anchor correction、shift rebase 必须走同一写入仲裁。

## 4. Physical Height Budget

推荐配置：

```ts
type PhysicalSegmentConfig = {
  maxPhysicalScrollHeightPx?: number; // e.g. 16000
  maxPhysicalViewportMultiplier?: number; // e.g. 4-6
  segmentShiftThresholdViewportMultiplier?: number; // e.g. 1.5-2
  minRealRowCoverageViewportMultiplier?: number; // e.g. 1
};
```

实际上界：

```ts
const scrollHeightCap = Math.max(
  viewportHeight,
  Math.min(
    maxPhysicalScrollHeightPx ?? Infinity,
    viewportHeight * (maxPhysicalViewportMultiplier ?? 5),
  ),
);
```

`scrollHeightCap` 是 full segment 的 normal cap。选择 active segment 时先确定 committed `physicalWindowHeight`，之后在同一个 `segmentRevision` 内冻结：

```ts
const normalPhysicalWindowHeight = scrollHeightCap;

const shortFeedPhysicalWindowHeight = Math.max(
  clientHeight,
  actualShortFeedContentHeight,
);

const physicalWindowHeight = isShortFeed
  ? shortFeedPhysicalWindowHeight
  : normalPhysicalWindowHeight;
```

稳定帧里真正暴露给 DOM 和 scrollbar 的值是 committed `physicalWindowHeight`：

```ts
const segmentContentHeight =
  topSpacer + mountedRowsHeight + bottomSpacer + naturalBlankHeight;

assert(segmentContentHeight === physicalWindowHeight);

const domScrollHeight = physicalWindowHeight;
const maxScrollPosition = Math.max(0, physicalWindowHeight - clientHeight);
```

因此 `physicalWindowHeight` 不是一个和 DOM 脱节的预算数，也不是 measurement 后的 fitted content height。它必须在稳定帧中和 DOM `scrollHeight` 对齐；custom scrollbar 使用的 `physicalWindowSize` 就是这个 committed 值。

Measurement correction 必须先守恒总高度。normal / exceptional-row 通过 spacer 反向吸收 delta；short-feed 的 `naturalBlankHeight` 是自然空白，不参与 spacer correction，内容高度变化必须重新 relayout：

```ts
const mountedRowsDelta =
  measuredMountedRowsHeight - previousMountedRowsHeight;

const spacerDelta = -mountedRowsDelta;
applySpacerCorrection(spacerDelta);

assert(topSpacer + mountedRowsHeight + bottomSpacer === physicalWindowHeight);
```

如果 spacer 无法安全吸收 delta，或者吸收后破坏 row coverage / safe scroll range，必须进入 `SegmentRelayout`。禁止通过直接改大 `physicalWindowHeight` 让 thumb 变小。

超大单条消息可能超过 `scrollHeightCap`。此时不能截断真实 row，也不能制造空洞。允许进入异常 cap：

```ts
effectivePhysicalWindowHeight =
  max(scrollHeightCap, mountedRowsHeight + minimumSafeBuffer);
```

此时 `capMode = 'exceptional-row'`，且 `physicalWindowHeight = effectivePhysicalWindowHeight`。

同时必须发出 diagnostics：

```text
physical.capExceededByRow
```

这不是常规路径。实现应尽量通过 segment relayout 减少挂载 rows，而不是长期扩大 cap。

## 5. Window And Spacer Semantics

旧语义：

```text
topSpacer = loaded items before renderWindow
bottomSpacer = loaded items after renderWindow
```

新语义：

```text
topSpacer = active segment 内真实 row 之前的 local blank budget
bottomSpacer = active segment 内真实 row 之后的 local blank budget
```

因此 window 计算必须按高度预算裁剪，而不是只按 item count 裁剪。

```text
select anchor
-> walk rows by estimated height within physical budget
-> ensure safe-scroll-range row coverage
-> solve local spacers so mountedRowsHeight + spacers == physicalWindowHeight
-> publish projection
```

`maxMountedItems` 只能作为兜底保护。新主约束是：

```text
maxMountedHeight = physicalWindowHeight - minimumSafeSpacerBudget
```

### 5.1 Real Row Coverage

Coverage 不能只检查 viewport 是否碰到一条 row。Runtime 必须计算 safe scroll range：

```ts
const realRowStartPx = topSpacer;
const realRowEndPx = topSpacer + mountedRowsHeight;

const safeScrollRangeStart = realRowStartPx;
const safeScrollRangeEnd = Math.max(
  safeScrollRangeStart,
  realRowEndPx - clientHeight,
);
```

在 stable frame 中，只要 `scrollTop` 位于 safe scroll range，viewport 区间 `[scrollTop, scrollTop + clientHeight]` 必须被连续真实 row 或真实 placeholder 覆盖：

```ts
realRowCoveragePx >= min(clientHeight, minRealRowCoveragePx)
```

默认 `minRealRowCoveragePx = clientHeight`。短 feed 可以低于该值，但剩余空间必须是 feed 自然空白，不是 top/bottom spacer 暴露。shift trigger、rebase、wheel momentum 和 drag soft stop 都必须把用户留在 safe scroll range 内，或立即进入 `SegmentShift` / `SegmentRelayout`。

如果 `mountedRowsHeight < clientHeight`，safe scroll range 退化为空，此时按 short-feed 规则处理，不把它当成 coverage failure。

## 6. Custom Scrollbar Geometry

Native scrollbar 必须隐藏。它的 thumb 几何由浏览器根据 DOM `scrollHeight` 推导，不允许作为用户可见语义。

Custom scrollbar 的输入：

```ts
type PhysicalScrollbarMetrics = {
  physicalSegmentId: string | null;
  physicalSegmentRevision: number;
  viewportSize: number;
  physicalWindowSize: number;
  domScrollHeight: number;
  maxScrollPosition: number;
  scrollHeightCap: number;
  capMode: 'normal' | 'short-feed' | 'exceptional-row';
  safeScrollRangeStart: number;
  safeScrollRangeEnd: number;
  scrollPosition: number;
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

Thumb 长度：

```ts
thumbLength = clamp(
  trackLength * viewportSize / physicalWindowSize,
  MIN_THUMB_PX,
  trackLength,
);
```

拖拽映射：

```text
pointer delta -> thumb progress -> physical scrollTop
```

这里的“1:1”不是指 pointer 1px 等于内容 1px，而是指映射线性、稳定，只依赖当前 physical window，不依赖已加载数据量。禁止加入“历史越多拖得越慢”的缩放系数。

Drag 期间：

- `isDragLocked = true`
- 当前 segment 内的 pointer delta 仍线性映射到 `scrollTop`
- 到达边界先记录 `pendingShiftDirection`
- 指针越界距离记录为 `pendingEdgeOverflowPx`，用于 diagnostics、prefetch 和 handoff 决策
- 如果相邻 segment 数据已 ready，或 pending need 在 pointer 仍按下时 resolve，runtime 可以在同一 drag session 内启动 `DragSegmentHandoff`
- handoff commit 前 thumb freeze，禁止继续把 pointer delta 写入旧 segment
- handoff commit 后将 `scrollTop` rebase 到新 segment 的 drag continuation band，重置 drag baseline，然后继续消费后续 pointer delta
- target data 缺失时 thumb 保持在当前 segment 合法 edge；这只是等待态，不允许把用户拖进 spacer-only 区

pointerup 只结束 drag session。正常体验不依赖 pointerup 才跨段；如果 pointerup 时仍有未完成 boundary intent，可作为 fallback 排队普通 `SegmentShift` 或保持当前 segment edge，具体取决于 target data 是否可用。

## 7. Segment Shift Transaction

`SegmentShift` 是几何事务，不是 prepend / append 的副作用。

```text
freeze scroll intent
-> set READY_SEGMENT_SHIFTING / viewportPhase SEGMENT_SHIFTING
-> confirm target segment data exists
-> if missing: set READY_SEGMENT_SHIFT_PENDING, emit needMoreBefore/After or needMessagesAround
-> build target PhysicalSegment
-> allocate nextSegmentRevision
-> publish target rows + local spacers + ProjectionCommitToken in one projection
-> wait React commit ack for the same ProjectionCommitToken
-> measure target rows
-> rebase scrollTop away from shift boundary
-> promote pending segment metrics to committed metrics
-> commit anchor state
-> resume drag writer if pointer is still down, otherwise release scroll intent
-> return READY_IDLE
```

非 drag shift 的 rebase 必须落在安全区：

```text
shift before -> scrollTop = physicalWindowHeight - clientHeight - bottomThreshold - epsilon
shift after  -> scrollTop = topThreshold + epsilon
```

目标是避免 commit 后下一帧立即再次触发 shift。

custom scrollbar drag handoff 使用另一条 continuation rebase。它的目标不是靠近新 segment 的边界，而是把 thumb 回收到轨道中段附近，同时不离开 safe scroll range：

```text
desired = maxScrollPosition * 0.5
drag handoff -> scrollTop = clamp(desired, safeScrollRangeStart, safeScrollRangeEnd)
```

`0.5` 是默认 continuation ratio，后续可配置但必须保持在中段安全区语义内。如果 safe range 过窄，则选择最接近轨道中段的合法位置。这样向上拖到顶部 boundary 后，thumb 回落到轨道中段附近；向下拖到底部 boundary 后，thumb 上升到轨道中段附近，并继续响应同一次 pointer drag。

## 8. Segment Relayout

`SegmentRelayout` 只重建当前 logical segment，不跨到相邻 segment。

`SegmentRelayout` 是独立且必需的 transaction kind。实现不得把它折叠进普通 `resize`、`projectionRefresh` 或 `SegmentShift`。

Same logical segment 的定义：

```text
same logicalSegmentId
same logicalRole
same logicalAnchorKey
renderWindowStartKey >= logicalStartItemKey
renderWindowEndKey <= logicalEndItemKey
adjacent segment relation unchanged
```

如果 relayout 需要改变 logical bounds、role、anchor 或 adjacency，它已经不是 relayout，必须升级为 `SegmentShift`、`jump/restore` 或 `followBottom`。

触发来源：

- container width / height resize
- mounted row measurement 大幅偏离估算
- mountedRowsHeight + spacers 超过 physical cap
- viewport 内真实 row 覆盖不足

推荐 reason 枚举：

```ts
type SegmentRelayoutReason =
  | 'resize'
  | 'measurement'
  | 'coverage-risk'
  | 'cap-exceeded'
  | 'cap-fallback'
  | 'spacer-oscillation'
  | 'bootstrap-stabilization';
```

规则：

- relayout 可以改变 render window start/end。
- relayout 可以改变 top/bottom spacer。
- relayout 默认继承上一 revision 的 `physicalWindowHeight`，并通过 spacer 重新分配保持总高度守恒。
- relayout 只有在 clientHeight 超过当前 physicalWindowHeight、short feed 状态变化、或 exceptional cap 时才能改变 `physicalWindowHeight`。
- relayout 不能顺手发起分页。
- relayout 不能把历史 segment 隐式切成 latest segment。
- relayout 结束后如果仍在边界，再由独立 shift intent 决定是否 shift。

Measurement correction 分两级：

| Case | Action |
| --- | --- |
| 小偏差，可由 spacer 反向吸收且不破坏 coverage/cap | local spacer correction |
| 大偏差，无法守恒或破坏 coverage/cap | segment relayout |

## 8.1 Projection Refresh Hard Boundary

`projectionRefresh` 只能刷新 active projection 内的 row payload。它不是 geometry transaction。

允许：

- 更新已经挂载 item 的内容字段。
- 增删不在 active render window 内的 DataWindow item。
- 发布新的 projection revision / commit token。

禁止：

- 改变 `segmentId` / `segmentRevision` / `logicalSegmentId`
- 改变 `physicalWindowHeight` / `scrollHeightCap` / `capMode`
- 重选 render window start/end
- 改变 top/bottom spacer
- 写 `scrollTop`
- 触发 pagination

如果 row payload 变化导致测量 delta，后续只能进入 local spacer correction 或 `SegmentRelayout`，不能在 `projectionRefresh` 中顺手修 geometry。

## 9. State Axes

Lifecycle:

```ts
type RuntimeState =
  | 'INITIAL'
  | 'ATTACHED'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'DETACHED'
  | 'DESTROYED';
```

Bootstrap 子状态：

```ts
type BootstrapState =
  | 'INITIAL'
  | 'MOUNTING'
  | 'MEASURING'
  | 'STABILIZING'
  | 'READY'
  | 'READY_EMPTY';
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

`isDragLocked` 是独立 boolean，不并入 bottom lock 或 viewport phase。

## 10. Bottom Lock

`BottomLockState` 只表达“是否锁在 feed latest”。它不能表示“是否到达当前 DOM 物理底部”。

```ts
function canBeLocked(input: {
  hasMoreAfter: boolean;
  activeSegmentRole: PhysicalSegment['logicalRole'];
  distanceToPhysicalBottom: number;
}): boolean {
  return (
    !input.hasMoreAfter &&
    input.activeSegmentRole === 'latest' &&
    input.distanceToPhysicalBottom <= LOCK_THRESHOLD_PX
  );
}
```

历史 segment 即使滚到物理底，也必须是 `UNLOCKED`。

## 11. Edge Need Latch

Edge need 不能只按 data revision latch。新的 latch key：

```ts
type EdgeNeedLatchKey = {
  feedId: string;
  generation: number;
  dataRevision: number;
  physicalSegmentId: string;
  physicalSegmentRevision: number;
  edge: 'before' | 'after';
};
```

原因：

- data revision 不变时，segment shift / relayout 仍会改变物理边界。
- segment revision 不变时，data arrival 仍可能满足 pending shift。
- drag edge intent 不能复用旧 segment 的 latch。

## 12. Jump And Restore

远距离 jump / restore 是 target segment selection，不是长距离 scroll animation。

```text
resolve target in data space
-> if target data missing: READY_DESTINATION_PENDING + needMessagesAround
-> build target PhysicalSegment around target anchor
-> publish target segment
-> commit + measure
-> local anchor correction
-> optional bounded motion inside the target segment
```

禁止让 motion engine 跨不存在的全局高度滚动。

## 13. Diagnostics Contract

状态变化、transaction boundary、commit ack、settle 完成点，或被 diagnostics 显式采样的 scroll frame，必须能输出：

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
  bottomLockState: 'LOCKED' | 'UNLOCKED';
  viewportPhase: ViewportPhase;
  dataRevision: number;
};
```

默认采样策略是状态变化、事务边界和 settle 点。普通 scroll frame 只更新 physical metrics；diagnostics 不独立存储每帧记录，除非 dev-only debug sampling 明确开启，且不能触发 React 每帧 rerender。

违约分级：

| Diagnostic | Severity | Required action |
| --- | --- | --- |
| `physical.scrollHeightExceededCap` | error | segment relayout or exceptional cap |
| `physical.spacerOnlyViewport` | error | immediate anchor-based relayout |
| `physical.realRowCoverageInsufficient` | error | relayout or shift before exposing blank space |
| `physical.segmentShiftLoop` | error | suppress next shift, rebase to safe zone |
| `physical.spacerOscillationSameRevision` | warn/error | freeze spacer correction, relayout once |
| `physical.thumbGeometryDataCoupled` | architecture error | reject geometry update |
| `physical.capExceededByRow` | warn | exceptional cap + relayout opportunity |
| `physical.adjacentPrefetchMiss` | warn | enter pending shift but keep current segment stable |
| `scroll.momentumShiftLoop` | warn/error | latch, suppress residual delta, release after safe frame |

生产路径不 hard fail。开发和测试可以对 architecture error hard assert。

## 14. Open Points To Decide During Implementation

这些不是旧设计兼容问题，而是实现期需要定常量或选择数据结构的问题：

1. `segmentId` 的生成方式。
2. `MAX_PHYSICAL_SCROLL_HEIGHT` 默认值和 viewport multiplier 优先级。
3. `minimumSafeBuffer` 的默认高度。
4. diagnostics ring buffer 的保留策略、payload 压缩方式和 dev-only high-frequency sampling 开关。

这些点不能在实现中散落成临时 guard。必须在进入代码重构前补到本文或对应子文档。
