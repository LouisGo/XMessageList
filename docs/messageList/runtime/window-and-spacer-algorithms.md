# RenderWindow 与 Spacer 算法

## 1. Scope

本文档定义滚动容器内部的 window 滑动、trim 和 spacer 估算策略。

目标不是精确全局 offset，而是在 IM 场景下维持稳定可感知视口。

## 2. Terms

```ts
type RenderWindow = {
  startIndex: number;
  endIndex: number;
  itemKeys: MessageRuntimeItemKey[];
};

type WindowConfig = {
  minOverscanPx: number;
  maxOverscanPx: number;
  minMountedItems: number;
  maxMountedItems: number;
  trimMarginPx: number;
  defaultItemHeight: number;
};
```

推荐初始配置：

| Field               | Value                |
| ------------------- | -------------------- |
| `minOverscanPx`     | `2 * viewportHeight` |
| `maxOverscanPx`     | `6 * viewportHeight` |
| `minMountedItems`   | 120                  |
| `maxMountedItems`   | 800                  |
| `trimMarginPx`      | `3 * viewportHeight` |
| `defaultItemHeight` | 72                   |

这些值是起点。真实项目应通过消息密度、图片比例和 Electron 性能数据调整。

## 3. Window Sliding Trigger

Runtime 同时使用 scroll position 和 sentinels：

- scroll rAF tick 是权威触发。
- IntersectionObserver sentinel 是提前预热信号。

触发条件：

```ts
const nearTop = scrollTop < topSpacer + config.minOverscanPx;
const nearBottom =
  scrollHeight - scrollTop - clientHeight < bottomSpacer + config.minOverscanPx;
```

sentinel 进入 root margin 时可以提前发出 `needMoreBefore` / `needMoreAfter`，但不能直接修改 window。Window 修改必须进入 transaction。

## 4. Window Recompute

Window 以当前 viewport anchor 为中心重算。

```ts
function computeWindowAroundAnchor(input: {
  items: MessageDataItem[];
  anchorIndex: number;
  viewportHeight: number;
  heightCache: HeightCache;
  config: WindowConfig;
}): RenderWindow {
  const targetPxBefore = clamp(
    input.viewportHeight * 3,
    input.config.minOverscanPx,
    input.config.maxOverscanPx,
  );
  const targetPxAfter = clamp(
    input.viewportHeight * 4,
    input.config.minOverscanPx,
    input.config.maxOverscanPx,
  );

  const startIndex = walkBackwardByEstimatedHeight(
    input.anchorIndex,
    targetPxBefore,
  );
  const endIndex = walkForwardByEstimatedHeight(
    input.anchorIndex,
    targetPxAfter,
  );

  return clampMountedCount({ startIndex, endIndex }, input.config);
}
```

规则：

- `anchorIndex` 只是当前 DataSnapshot 内的派生值。
- 持久恢复和跨层定位不能使用 index。
- 如果当前 anchor 不存在，先使用 nearest visible item，再必要时 reset bootstrap。

## 5. Trim Order

Trim 必须与 spacer 更新在同一个 projection revision 中提交。

正确顺序：

```text
capture anchor
-> compute next window
-> compute spacer delta
-> publish snapshot(items slice + spacer)
-> wait commit
-> measure
-> correct scrollTop if needed
```

禁止：

```text
remove rows
-> next frame
-> increase spacer
```

## 6. Height Cache

```ts
type HeightRecord = {
  height: number;
  measuredAtRevision: number;
  contentVersion: number;
  widthBucket: number;
};
```

Cache key 使用 `MessageRuntimeItemKey`。

失效条件：

- feed generation 变化。
- container width bucket 变化。
- message content version 变化。
- density / font / theme 影响布局。
- optimistic rebind 后内容不等价。

容量策略：

- 保留当前 RenderWindow 全部 items。
- 保留 window 前后最近 200~500 条。
- 其余按 LRU 删除。

## 7. Spacer Estimation

单条估算：

```ts
function estimateItemHeight(key: MessageRuntimeItemKey): number {
  return (
    heightCache.get(key)?.height ??
    localAverageByKind.get(key.kind) ??
    feedRollingAverage ??
    config.defaultItemHeight
  );
}
```

范围估算：

```ts
function estimateRangeHeight(
  items: MessageDataItem[],
  start: number,
  end: number,
): number {
  let height = 0;
  for (let index = start; index < end; index += 1) {
    height += estimateItemHeight(getRuntimeItemKey(items[index]));
  }
  return height;
}
```

Spacer：

```ts
topSpacer = estimateRangeHeight(items, 0, renderWindow.startIndex);
bottomSpacer = estimateRangeHeight(
  items,
  renderWindow.endIndex + 1,
  items.length,
);
```

Spacer 高度必须 clamp 到 `>= 0`。

## 8. Prepend Spacer Correction

Prepend 前：

```text
capture anchor rect top
capture old topSpacer
```

Prepend projection：

```text
new items inserted
new topSpacer estimated
```

Commit 后：

```ts
const newAnchorTop = measureAnchorTop(anchorKey);
const delta = newAnchorTop - oldAnchorTop;
container.scrollTop += delta;
```

之后用实测 prepended rows 更新 height cache，再修正 topSpacer：

```ts
const estimatedPrependedHeight = previousTopSpacer - nextTopSpacerBeforeMeasure;
const measuredPrependedHeight = sumMeasuredPrependedRows();
const correction = measuredPrependedHeight - estimatedPrependedHeight;
topSpacer = Math.max(0, topSpacer + correction);
```

如果 anchor rect correction 已经消除了视觉漂移，spacer correction 只更新 projection，不再次改变用户可见位置，除非该 spacer 变化位于 anchor 上方且会改变 scrollHeight 中间态。

## 9. Append Spacer Correction

Append 在 unlocked 状态下不自动追底。

Append 在 locked 状态下：

```text
publish appended projection
-> commit
-> measure
-> scrollToBottom in rAF correction phase
```

不要依赖 exact equality：

```ts
distanceToBottom = scrollHeight - scrollTop - clientHeight;
```

该值只能在 transaction 稳定点读取。

## 10. Bottom Lock Distance

默认使用物理 DOM 计算：

```ts
function getDistanceToBottom(container: HTMLElement): number {
  return Math.max(
    0,
    container.scrollHeight - container.scrollTop - container.clientHeight,
  );
}
```

使用双阈值：

```ts
const LOCK_THRESHOLD_PX = 40;
const UNLOCK_THRESHOLD_PX = 120;
```

规则：

- `distance <= LOCK_THRESHOLD_PX` -> LOCKED
- `distance > UNLOCK_THRESHOLD_PX` -> UNLOCKED
- 中间区域保持当前状态

Bottom sentinel 可以作为辅助校验，但不作为唯一 truth。原因是 sentinel callback 与 layout/scroll event 不保证同一时序。

## 11. Identity Rebind

收到 `identity-remap`：

```text
pause window sliding
-> migrate height cache key
-> migrate row registry key if DOM still mounted
-> migrate anchor key if anchor points to optimistic item
-> publish snapshot with committed key
-> wait commit
-> verify anchor rect
```

React row key 策略：

- projection key 使用 runtime item key。
- optimistic -> committed 必须由 runtime 发出同一 transaction 的 remap 语义。
- 如果 React 必然 remount row，runtime 需要用 commit 后 rect correction 保持视觉位置。

## 12. Empty And Edge States

`items.length === 0` 时：

- `topSpacer = 0`
- `bottomSpacer = 0`
- no row measurement
- bootstrap 可以进入 READY_EMPTY

推荐 edge model：

```ts
type ViewportEdgeState = {
  before: 'idle' | 'loading' | 'exhausted' | 'error';
  after: 'idle' | 'loading' | 'exhausted' | 'error';
};
```

edge loading indicator 是 projection item 或 spacer 邻接元素，但不参与 message height cache。
