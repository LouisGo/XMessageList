# Oracles

## Evidence Shape

```ts
type ViewportEvidence = {
  feedId: string;
  generation: number;
  segmentRevision: number;
  projectionRevision: number;
  commitToken: {
    feedId: string;
    generation: number;
    segmentRevision: number;
    projectionRevision: number;
  } | null;
  modifier: SegmentModifier['type'];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  bottomLockState: 'LOCKED' | 'UNLOCKED';
  pendingIntent: string | null;
  shortSegmentAlignment: 'start' | 'center' | 'end';
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  visibleRows: Array<{
    key: string;
    stableId?: string;
    serverId?: string;
    rowKind: string;
    top: number;
    bottom: number;
  }>;
  beforeTrigger: DOMRectLike;
  afterTrigger: DOMRectLike;
  bottomMarker: DOMRectLike | null;
  phase: string;
  edgeState: {
    before: {
      status: string;
      latchToken?: string;
      requestToken?: string;
    };
    after: {
      status: string;
      latchToken?: string;
      requestToken?: string;
    };
  };
};
```

Evidence 不包含 topSpacer / bottomSpacer，因为 next 基座没有这两个概念。Evidence 必须包含 segment 边界、modifier、generation/revision/token；否则 bottom follow、after paging、underflow fill 和 identity-remap 都无法可靠验收。

## Anchor Preservation Oracle

通过条件：

- transaction 前后 anchor row key / identity 可解析到同一逻辑 row，或使用明确 fallback。
- anchor top delta <= 1px。
- 没有 unexpected viewportError。
- correction diagnostic 包含 delta 和 source。

失败条件：

- anchor 消失且没有 fallback。
- scrollTop 改变但 anchor top delta 仍大。
- recovery scroll 触发了新的 edge need。

## Native Scrollbar Oracle

Before extend：

- 记录 `scrollHeightBefore`、`scrollTopBefore`、thumb ratio。

After extend：

- `scrollHeightAfter > scrollHeightBefore`。
- visible anchor top delta <= 1px。
- `scrollTopAfter > scrollTopBefore` for before extend。
- thumb position 不再贴在 edge，且比例可由 native metrics 解释。

禁止通过 custom overlay 内部状态证明滚动条正确；overlay 只能辅助截图。

## Edge Need Oracle

通过条件：

- user/momentum source 进入 trigger margin 后发一次 need。
- 同 revision 同 edge 不重复发。
- recovery/programmatic source 不发。
- request settle 后 latch 按新 revision 释放。
- need event 和 evidence 中的 generation / segmentRevision / requestToken 一致。

## Underflow Oracle

通过条件：

- 短 segment 且两侧 trigger 同时可见时，最多一个 edge request in flight。
- underflow fill 的 source / pendingIntent 与 user edge need 可区分。
- 每次 segment settle 后才重新选择下一侧。
- 两侧 exhausted 后不继续重试。
- latest / locked bottom underflow 只补 before，不把 partial after 当 latest。

## Bottom Follow Oracle

通过条件：

- `hasMoreAfter=true` 时 follow bottom 发 latest need，不发 after need。
- latest reset 后 `hasMoreAfter=false` 才 LOCKED。
- locked append 后 bottom marker 在 viewport bottom threshold 内。
- unlocked append 不移动当前 visual anchor。

## Destination / Feed Switch Oracle

通过条件：

- jump / restore 目标在当前 segment 时，只做 local align，不发 around need。
- 目标不在当前 segment 时，发 `needMessagesAround(reason: 'jump' | 'restore')`，around reset 后对齐目标。
- feed detach 前发布 `viewportAnchorChanged(reason: 'detach')`，host 保存 identity anchor，不保存 raw `scrollTop`。
- feed 切回时 host 响应 runtime semantic event 返回 around / latest segment；旧 feed 的 edge latch、pending intent 和 generation 不进入新 feed。

## Dynamic Height Oracle

通过条件：

- row height 变化来自真实 DOM / ResizeObserver，不通过 reset 掩盖。
- above-anchor growth 后 visual anchor top delta <= 1px。
- ResizeObserver burst 后只发布稳定 observation / diagnostics，不触发 programmatic edge need。

## Segment Trim Oracle

通过条件：

- trim 后 item count 低于预算。
- visual anchor top delta <= 1px。
- scrollHeight 变化来自真实 DOM row 删除。
- hasMoreBefore/After 与被 trim 方向一致。

## Identity Remap Oracle

通过条件：

- local optimistic row 获得 server id 后，visible row key 保持稳定；若 key 改变，evidence / diagnostics 带 `previousKey -> nextKey`。
- 当前 visual anchor 经 remap 后仍能解析到 committed DOM row。
- anchor top delta <= 1px。
- `viewportAnchorChanged` 发布 remap 后的 stable/server identity，不继续持久化 local-only id。
- duplicate / deleted / permission fallback 由 data modifier 解释，不由 viewport 猜测。

## Performance Oracle

通过条件：

- scroll frame 中无长任务。
- segment extend correction 在 data ready 后两帧内完成。
- ResizeObserver burst 被合并。
- diagnostics 数量受限，不因每个 scroll event 爆炸。
