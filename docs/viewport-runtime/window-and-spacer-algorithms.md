# Window 与 Spacer 算法

本文定义 physical segment 下的 window、spacer 和 measurement 策略。Spacer 只代表当前 active segment 内的局部 overscan。

## 1. Core Rule

```text
projectionLayoutHeight =
  topSpacer + mountedRowsHeight + bottomSpacer + naturalBlankHeight
```

该值只属于 active physical segment。`naturalBlankHeight` 只允许 short-feed 使用；normal / exceptional-row 中必须为 0。稳定帧中 DOM `scrollHeight` 必须和 runtime 暴露的 `physicalWindowHeight`、custom scrollbar 使用的 `physicalWindowSize` 对齐：

```ts
projectionLayoutHeight =
  topSpacer + mountedRowsHeight + bottomSpacer + naturalBlankHeight;
assert(projectionLayoutHeight === physicalWindowHeight);
domScrollHeight = physicalWindowHeight;
maxScrollPosition = max(0, physicalWindowHeight - clientHeight);
```

`scrollHeightCap` 是 normal cap，不能作为 thumb size 的基线。thumb size 使用 committed `physicalWindowHeight`。

## 2. Inputs

```ts
type PhysicalWindowInput = {
  data: MessageDataSnapshot;
  anchor: AnchorState | null;
  viewportHeight: number;
  viewportWidth: number;
  physicalWindowHeight: number;
  directionHint?: 'before' | 'after' | 'target' | 'latest';
};
```

本文中的 `viewportHeight` 必须来自 scroll container 的 `clientHeight`。推导 DOM 几何等式时使用 `clientHeight` 命名，避免把预算高度和实际视口高度混在一起。

`data.items.length` 不决定 physical height。它只决定哪些 row 可以被选入 active segment。`input.physicalWindowHeight` 是已提交的 segmentRevision 常量，window/spacer 算法只能在这个高度内重新分配 rows 和 spacer，不能根据 measurement 重新拟合它。

## 3. Segment Window Selection

推荐流程：

```text
choose anchor key
-> resolve anchor index inside DataWindow
-> walk backward by estimated row height until top buffer target or cap
-> walk forward by estimated row height until bottom buffer target or cap
-> ensure safe-scroll-range row coverage
-> clamp by maxMountedHeight and maxMountedItems
-> compute local top/bottom spacer
```

伪代码：

```ts
function computePhysicalSegmentWindow(input: PhysicalWindowInput): RenderWindow {
  const topTarget = input.viewportHeight * TOP_BUFFER_VIEWPORTS;
  const bottomTarget = input.viewportHeight * BOTTOM_BUFFER_VIEWPORTS;
  const maxMountedHeight =
    input.physicalWindowHeight - input.viewportHeight * MIN_SPACER_VIEWPORTS;

  const range = walkAroundAnchorByEstimatedHeight({
    items: input.data.items,
    anchor: input.anchor,
    topTarget,
    bottomTarget,
    maxMountedHeight,
    width: input.viewportWidth,
  });

  return clampRangeByCoverageAndCount(range);
}
```

`maxMountedItems` 是安全阀，不是主预算。主预算是 mounted rows 的估算高度。

## 4. Spacer Semantics

```ts
type LocalSpacerPlan = {
  topSpacer: number;
  bottomSpacer: number;
  naturalBlankHeight: number;
  mountedRowsHeightEstimate: number;
  physicalWindowHeight: number;
};
```

规则：

- `topSpacer` 是 active segment 内真实 row 之前的 local blank budget。
- `bottomSpacer` 是 active segment 内真实 row 之后的 local blank budget。
- `naturalBlankHeight` 只表达 short-feed 内容不足一个 viewport 时的自然剩余空间。它必须作为真实布局高度进入 projection，不能伪装成 top/bottom spacer。
- 两者不能包含 DataWindow 中远离 active segment 的累计历史高度。
- spacer 计算必须和 selected rows 同一个 revision / segmentRevision。
- spacer 变更必须通过 projection commit，不允许直接改 DOM style。

预算校验。normal / exceptional-row 中 `naturalBlankHeight` 必须为 0：

```ts
topSpacer + mountedRowsHeightEstimate + bottomSpacer === physicalWindowHeight
```

short-feed 中自然空白以真实布局高度发布：

```ts
topSpacer + mountedRowsHeightEstimate + bottomSpacer + naturalBlankHeight === physicalWindowHeight
```

同一 `segmentRevision` 内 normal / exceptional-row 必须守恒。测量后真实 mounted rows 发生 delta 时，优先对 top/bottom spacer 做反向 correction：

```ts
mountedRowsDelta + topSpacerDelta + bottomSpacerDelta === 0
```

如果 spacer 无法吸收 delta，或吸收后破坏 safe scroll range coverage，进入 `SegmentRelayout` 或 exceptional cap。

## 5. Coverage Rule

任何稳定帧中，safe scroll range 必须满足：

```text
realRowCoveragePx >= minRealRowCoveragePx
```

默认 `minRealRowCoveragePx = clientHeight`。这表示 viewport 在 safe scroll range 内必须被连续真实 row 或真实 placeholder 覆盖，不能只有 5% row 和 95% spacer。

如果 `mountedRowsHeight < clientHeight`，进入 short-feed 语义。短 feed 的自然空白允许存在，但不得伪装成正常 segment 的 top/bottom spacer 暴露。

允许的空白：

- feed empty
- loading placeholder 是真实 projection item
- 短 feed 的自然剩余空间

禁止的空白：

- viewport 中只有 topSpacer / bottomSpacer
- viewport 中大部分是 topSpacer / bottomSpacer，只在边缘擦到一条 row
- shift pending 时把用户拖进没有 row 的物理区
- resize 后 cap 被 row 高度吃掉但未 relayout

## 6. Measurement Correction

ResizeObserver 和同步测量只产生 height deltas。delta 不能直接改全局 spacer。

分类：

```ts
type MeasurementCorrection =
  | { kind: 'local-spacer-correction'; topDelta: number; bottomDelta: number }
  | { kind: 'segment-relayout'; reason: SegmentRelayoutReason };
```

进入 `local-spacer-correction` 的条件：

- cap 仍满足
- safe scroll range 真实 row coverage 仍满足
- correction 不会让当前 scrollTop 落入 spacer-only 区
- 同一 data revision 下没有出现 spacer 震荡

进入 `segment-relayout` 的条件：

- mountedRowsHeight 超过 physical budget
- safe scroll range coverage 不足
- resize 改变 row wrap 模型
- 同一 revision 下 local spacer correction 反复摆动

## 7. Segment Shift Trigger

Trigger 只产生 intent：

```ts
const topThreshold = viewportHeight * SHIFT_TOP_VIEWPORTS;
const bottomThreshold = viewportHeight * SHIFT_BOTTOM_VIEWPORTS;

const needShiftBefore = scrollTop <= topThreshold;
const needShiftAfter =
  scrollTop >= physicalWindowHeight - viewportHeight - bottomThreshold;
```

规则：

- drag 期间不 shift，只记录 `pendingShiftDirection` 和 `pendingEdgeOverflowPx`。
- wheel / keyboard 可以排队 shift，但仍必须进入 transaction。
- target data 缺失时进入 `READY_SEGMENT_SHIFT_PENDING`。
- data 到达后由 segment shift / followBottom 消费，不再跑 legacy continuous-scroll anchor recovery。

## 8. Short Feed

短 feed 不强行制造大物理空间。

```text
shortFeedContentHeight = topSpacer + mountedRowsHeight + bottomSpacer
physicalWindowHeight = max(clientHeight, shortFeedContentHeight)
naturalBlankHeight = physicalWindowHeight - shortFeedContentHeight
domScrollHeight = physicalWindowHeight
maxScrollPosition = max(0, physicalWindowHeight - clientHeight)
```

如果 `shortFeedContentHeight < clientHeight`，committed `physicalWindowHeight` 仍然等于 `clientHeight`，`naturalBlankHeight` 必须进入 projection 形成真实 DOM 布局高度，`maxScrollPosition = 0`，custom scrollbar 不显示可拖动 thumb。短 feed 可以没有 shift。latest short feed 在 `hasMoreAfter === false` 且接近物理底时可以 `LOCKED`。

## 9. Latest Segment

latest segment 是唯一允许 bottom lock 的 segment。

`followBottom` 不是滚到当前 physical bottom。它必须：

```text
ensure latest data
-> build latest physical segment
-> commit
-> scroll to latest segment bottom
-> set LOCKED
```

如果 `hasMoreAfter === true`，即使当前 physical segment 滚到底，也不能 `LOCKED`。

## 10. Diagnostics

Window/spacer 层必须输出：

- `physical.windowSelected`
- `physical.segmentRelayout`
- `physical.scrollHeightExceededCap`
- `physical.spacerOnlyViewport`
- `physical.spacerOscillationSameRevision`
- `physical.capExceededByRow`

所有 diagnostics 必须携带：

```text
dataRevision, physicalSegmentId, physicalSegmentRevision,
renderWindowStart, renderWindowEnd,
topSpacer, bottomSpacer, mountedRowsHeight,
scrollHeight, domScrollHeight, physicalWindowHeight, maxScrollPosition, scrollHeightCap,
capMode, safeScrollRangeStart, safeScrollRangeEnd,
realRowCoveragePx, minRealRowCoveragePx
```
