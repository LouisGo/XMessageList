# Scroll Motion 与 Custom Scrollbar

本文定义 physical segment 架构下的拖拽、滚动动画和 `scrollTop` 写入权。

## 1. Core Rule

Motion 不负责跨数据空间移动。它只在已经稳定的 physical segment 内移动。

```text
far destination -> select/build target segment
target segment stable -> optional bounded motion inside that segment
```

## 2. Custom Scrollbar

Native scrollbar 必须隐藏。可见 thumb 由 custom scrollbar 渲染。

Custom scrollbar 不读取全局 DataWindow，也不根据已加载消息数量计算 thumb。

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

Thumb geometry：

```ts
if (maxScrollPosition === 0) {
  thumbLength = trackLength;
  thumbTop = trackStart;
  isDraggable = false;
} else {
  thumbLength = clamp(
    trackLength * viewportSize / physicalWindowSize,
    MIN_THUMB_PX,
    trackLength,
  );

  thumbTop =
    trackStart +
    (trackLength - thumbLength) * scrollPosition / maxScrollPosition;
}
```

`physicalWindowSize` 是 active segment 的 committed `physicalWindowHeight`，稳定帧中必须等于 `domScrollHeight`。`maxScrollPosition` 必须从该值派生，不能从 DataWindow 长度或 `scrollHeightCap` 派生。

## 3. Drag Semantics

拖拽开始：

```text
beginDirectScroll(custom-scrollbar-drag)
-> set isDragLocked true
-> cancel active motion
-> freeze segment shift execution
```

拖拽中：

```text
pointer movement
-> linear thumb progress
-> write current segment scrollTop
-> if boundary reached: clamp thumb at edge, record pendingShiftDirection and pendingEdgeOverflowPx
```

拖拽结束：

```text
endDirectScroll(custom-scrollbar-drag)
-> set isDragLocked false
-> if pendingShiftDirection: enqueue SegmentShift
```

禁止：

- drag 中执行 segment shift
- drag 中根据数据量缩放 pointer delta
- drag 中让 thumb 越出 track
- drag 中由 ResizeObserver 或 motion 抢写 `scrollTop`

### 3.1 Drag Continuity

跨段拖拽的连续感来自“边界软停 + 松手后 shift”，不是拖拽中途 rebase。

规则：

- 同一次 pointer drag session 内不执行 `SegmentShift`，也不做跨段 rebase。
- 指针越过 track 边界时，thumb 固定在合法 edge，runtime 继续记录 `pendingShiftDirection` 和 `pendingEdgeOverflowPx`。
- `pendingEdgeOverflowPx` 只用于 diagnostics 和 pointerup 后的 shift 决策，不能在当前 segment 内继续扩大 `scrollTop`。
- pointerup 后如果触发 shift，当前 drag session 结束；下一次 pointerdown 才能进入新 segment 的拖拽。
- 如果 shift abort，thumb 回到 release 时所在的合法 edge，不使用任何 speculative next-segment 位置。

## 4. Thumb Freeze

pointerup 后如果立刻执行 shift，custom scrollbar 必须短暂 freeze thumb。

```text
release pointer
-> freeze thumb at release visual position
-> run SegmentShift
-> commit target segment
-> rebase scrollTop to safe zone
-> next frame unfreeze and sync target metrics
```

Freeze 生命周期是确定的：

```text
start: pointerup accepted a pending shift
end: segmentShift commit/abort has published final physical metrics and one paint frame has passed
```

freeze 期间 `isThumbFrozen = true`，custom scrollbar 不从旧 DOM `scrollTop` 重新计算 thumb。

没有 thumb freeze，用户会看到松手瞬间 thumb teleport。这是架构缺陷，不是视觉瑕疵。

## 5. Track Click

Track click 可以直接请求当前 physical segment 内的位置：

```text
track click -> target scrollTop in active segment -> direct write
```

如果 target 落入 shift trigger 区：

- 非 drag 输入可以排队 shift。
- shift 仍必须走 transaction。
- target data 缺失时进入 `READY_SEGMENT_SHIFT_PENDING`。

## 6. Motion Engine

Motion engine 只处理这些场景：

- latest segment 内 follow-bottom 到底
- target segment 内 jump / restore 微动
- reduced motion disabled 时的 bounded visible movement

推荐接口：

```ts
class ScrollMotionEngine {
  start(input: ScrollMotionStart): void;
  cancel(reason: ScrollMotionCancelReason): void;
  isActive(): boolean;
  adjustTarget(deltaPx: number): void;
}
```

Motion 规则：

1. 每帧只写 `scrollTop`。
2. 不读 row rect。
3. 不 publish projection。
4. 不触发 edge need。
5. 新 transaction、drag、generation change、detach、destroy 必须同步取消 motion。

远距离 motion 的处理：

```text
if target not in active segment:
  do not animate
  build target segment first
else if distance > maxDistancePx:
  preposition inside same segment near target
  animate final bounded distance
```

## 7. Wheel And Trackpad Momentum

Wheel / trackpad 可以在边界触发 `SegmentShift`，但必须有 momentum latch，不能把残余 delta 直接灌进新 segment。

规则：

- 第一次越过 shift trigger band 时，记录 `pendingShiftDirection`，设置 `isMomentumLatched = true`，并排队一个 `SegmentShift`。
- latch 期间继续到达的 wheel / momentum delta 只累积为 `suppressedMomentumDeltaPx`，不再写 `scrollTop`，不重复排队 shift。
- shift commit 后，runtime 先 rebase 到 safe zone，等待一帧，再释放 latch。
- 默认丢弃跨段残余 delta。只有目标 segment 已稳定且残余方向不会立即触发下一次 shift 时，才允许把一小段 delta 重新应用到当前 segment 内。
- macOS overscroll bounce 产生的反向 delta 必须被 clamp 到 safe scroll range 内，不能触发反向 shift loop。

Keyboard page scroll 使用同一 latch 规则，但没有 momentum residual。

## 8. Scroll Source

```ts
type ScrollSource =
  | 'user'
  | 'wheel'
  | 'keyboard'
  | 'programmatic'
  | 'recovery'
  | 'followBottom'
  | 'jump'
  | 'momentum';
```

Direct scrollbar drag 归类为 user intent，但写入路径必须带 `DirectScrollInput`，以便 runtime 设置 drag lock 和 edge intent。

禁止滥用 `recovery`：

- segment shift rebase 使用 segment shift correction source。
- follow-bottom 使用 `followBottom`。
- jump / restore 使用 `jump`。
- anchor correction 使用 `recovery`。

如果实现层暂时没有新的 source enum，diagnostics 必须至少记录真实 transaction kind，不能让所有写入都显示为 recovery。

## 9. Bottom Lock And Motion

Motion settle 才能提交 bottom lock。

```text
followBottom command
-> ensure latest segment
-> motion/instant write to latest bottom
-> settle
-> bottomLockState LOCKED
```

历史 segment 的 physical bottom 不能通过 motion settle 变成 `LOCKED`。

## 10. Diagnostics

滚动和 motion 层必须输出：

- `scroll.direct.begin`
- `scroll.direct.write`
- `scroll.direct.end`
- `scroll.dragLock.changed`
- `scroll.thumb.freeze`
- `scroll.thumb.unfreeze`
- `motion.start`
- `motion.cancel`
- `motion.settle`
- `motion.rejectedGlobalDistance`
- `scroll.momentum.latch`
- `scroll.momentum.release`
- `scroll.momentum.suppressDelta`

关键字段：

```text
source, scrollTop, physicalWindowSize, maxScrollPosition,
scrollHeightCap, capMode, safeScrollRangeStart, safeScrollRangeEnd,
isDragLocked, isThumbFrozen,
pendingShiftDirection, pendingEdgeOverflowPx,
isMomentumLatched, suppressedMomentumDeltaPx,
physicalSegmentId, physicalSegmentRevision
```
