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
  overscan?: number;
  maxMountedItems?: number;
};
```

当前原型默认配置：

| Field             | Value |
| ----------------- | ----- |
| `overscan`        | 3     |
| `maxMountedItems` | 200   |

`overscan` 是 viewport 倍数，不是像素阈值。`maxMountedItems` 是硬上限，不是目标 DOM 数量；实际 mounted row count 由 viewport、消息高度、数据边界和内部安全下限共同决定。

Runtime 内部保留 `MIN_MOUNTED_ITEMS = 40` 和 `DEFAULT_ITEM_ESTIMATE_PX = 104`。正常文档流方案不把高度估算作为公开配置；估算只用于未测量区域的 spacer/window 粗估，真实稳定性依赖 commit 后同步测量、ResizeObserver dirty batching 和 anchor rect correction。

## 3. Window Sliding Trigger

Runtime 同时使用 scroll position 和 sentinels：

- scroll rAF tick 是权威触发。
- IntersectionObserver sentinel 是提前预热信号。

触发条件：

```ts
const edgeThresholdPx = clientHeight * config.overscan;
const nearTop = scrollTop < topSpacer + edgeThresholdPx;
const nearBottom =
  scrollHeight - scrollTop - clientHeight < bottomSpacer + edgeThresholdPx;
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
  const targetPxBefore = input.viewportHeight * input.config.overscan;
  const targetPxAfter = input.viewportHeight * input.config.overscan * 1.25;

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

- `latest bootstrap`、`followBottom`、bottom locked append 不再只依赖固定条数窗口；当前实现会把最后一条 item 作为局部 anchor，走同一套 viewport-aware window 计算。
- 如果 container 暂时拿不到有效 viewport 尺寸，latest window 会退回到尾部内部最小 mounted 条数的保守 fallback。
- 内部最小 mounted 条数和 `maxMountedItems` 约束的是 mounted projection rows，不承诺等于业务 message 条数。
- `anchorIndex` 只是当前 DataSnapshot 内的派生值。
- 持久恢复和跨层定位不能使用 index。
- 如果当前 anchor 不存在，先使用 nearest visible item，再必要时 reset bootstrap。
- 当 anchor 靠近数据边界、窗口条数仍低于内部最小 mounted 条数时，缺少的 quota 会尽量向还有剩余数据的一侧补齐。

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

当前原型里的 cache trim 比较保守：

- 只在 `heightCache.size > 1000` 时触发删除。
- 优先删除已经不在当前 data snapshot 里的 key。
- 尚未实现文档草案里的 window-adjacent LRU 分层回收。

派生缓存必须和持久 height cache 区分：

- height cache 按 `MessageRuntimeItemKey` 跨 projection revision 复用。
- RenderWindow index、projection slice、spacer range 这类派生缓存只能在同一个
  `feedId + generation + data.revision` 内复用。
- `items` 数组引用相同不代表 data 未变化；只要 `revision` 变化，派生缓存就必须
  失效或切换到新的 revision cache。
- 派生 range / slice cache 必须有容量上限，避免长 DataWindow 内频繁 window slide
  把 CPU 优化变成内存增长。

## 7. Spacer Estimation

单条估算：

```ts
function estimateItemHeight(item: MessageDataItem): number {
  return (
    heightCache.get(getRuntimeItemKey(item))?.height ??
    item.estimatedHeight ??
    DEFAULT_ITEM_ESTIMATE_PX
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

之后用实测 prepended rows 更新 height cache。

当前实现不会在同一个 prepend transaction 里再额外 publish 一次 spacer-correction projection；measured height 会写回 cache，并在后续 projection 重算 `topSpacer` / `bottomSpacer` 时生效。prepend 当帧的视觉稳定仍然主要依赖 anchor rect correction。

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
