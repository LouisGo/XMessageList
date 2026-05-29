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

真实浏览器 E2E bridge 在 `ViewportEvidence` 外增加稳定测试字段：

```ts
type E2EEvidence = ViewportEvidence & {
  schemaVersion: 2;
  scenarioId: string;
  checkpointId: string;
  timestamp: number;
  segment: {
    itemCount: number;
    firstKey: string | null;
    lastKey: string | null;
    firstIdentity: { stableId?: string; serverId?: string; localId?: string } | null;
    lastIdentity: { stableId?: string; serverId?: string; localId?: string } | null;
    modifier: SegmentModifier;
  };
  events: Array<{
    type: string;
    feedId?: string;
    generation?: number;
    segmentRevision?: number;
    requestToken?: string;
    reason?: string;
    edge?: 'before' | 'after';
    anchor?: MessageIdentityAnchor | null;
  }>;
  diagnostics: ViewportDiagnosticRecord[];
  overlay: {
    visible: boolean;
    thumbTop: number;
    thumbHeight: number;
    expectedThumbTop: number;
    expectedThumbHeight: number;
    trackHeight: number;
  } | null;
};
```

`E2EActionResult` may include named `checkpoints` when a single user action needs to prove pre-settle and post-settle state, for example before-edge trigger evidence captured after `needMoreBefore` but before the delayed mock response applies.

E2E bridge 只能用这些字段判定场景；失败报告必须带 action result、event log、diagnostics 和必要截图，不能通过读取 runtime private object 补答案。

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

## Custom Overlay Oracle

通过条件：

- thumb length 和 position 只由 native `scrollTop` / `clientHeight` / `scrollHeight` 推导。
- drag / track click 只调用 runtime direct scroll writer，不访问 paging、bottom lock、trim 或 anchor correction 状态。
- overlay metric mismatch 进入 `overlay.metricMismatch` warning diagnostic。

## Scrollbar Drag Continuity Oracle

通过条件：

- held drag 触边后，当前 edge loading 未完成前同方向最多一个请求。
- edge loading 完成后，thumb 随真实 scroll range 自然回落或抬升，并进入稳定位置。
- 同一次 held drag 在 loading 完成后保持连续，不取消、不重启、不锁死、不要求释放。
- 用户没有新的同方向拖拽位移时，不因指针仍在边缘坐标而再次触发 loading。
- 用户继续拖动时，thumb 从回落或抬升后的当前位置继续移动。
- 不出现一帧回落后瞬间吸回边缘的闪烁循环。

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

- jump 目标在当前 loaded segment 时，只做 local align，不发 around need。
- jump 目标已在当前视口内时，不显示 overlay loading，不重建列表。
- jump 目标不在当前 loaded segment 时，发 `needMessagesAround(reason: 'jump')`，around reset 后对齐目标。
- jump 目标默认 center align，受真实内容边界限制时使用最接近 center 的可达位置。
- jump 完成后目标消息或 fallback 高亮。
- 跨 feed jump 最终展示目标 feed，慢于 200ms 时显示居中 overlay loading，快于 200ms 时不显示 overlay loading。
- jump 不通过 before / after edge loading 逐页滚到目标。
- 连续多个 jump 以最后一次用户意图为准，旧目标结果不能覆盖新目标。
- restore 目标在当前 segment 时，只做 local align，不发 around need。
- restore 目标不在当前 segment 时，发 `needMessagesAround(reason: 'restore')`，around reset 后对齐目标。
- feed detach 前发布 `viewportAnchorChanged(reason: 'detach')`，host 保存 identity anchor，不保存 raw `scrollTop`。
- feed 切回时 host 响应 runtime semantic event 返回 around / latest segment；旧 feed 的 edge latch、pending intent 和 generation 不进入新 feed。

## Dynamic Height Oracle

通过条件：

- row height 变化来自真实 DOM / ResizeObserver，不通过 reset 掩盖。
- above-anchor growth 后 visual anchor top delta <= 1px。
- ResizeObserver burst 后只发布稳定 observation / diagnostics，不触发 programmatic edge need。

## Live Event Oracle

通过条件：

- 他人 append：locked bottom 保持底部，unlocked history 保持当前 visual anchor。
- 本人发送：回到 latest，不逐页补齐中间缺口。
- reaction / edit：可见 row 就地更新；不可见 row 不移动当前画面。
- streaming：locked bottom 保持追底；非 locked 状态保持当前阅读位置。
- visible delete：目标消失或 fallback，当前阅读位置稳定，不跳 latest。
- loaded outside-view delete：当前 visual anchor 稳定，scrollHeight 只按真实 DOM 变化。
- unloaded delete：当前 loaded segment 和 scroll range 不发生可见变化。
- batch non-contiguous delete：最终删除集合完整，当前 visual anchor 稳定，不逐条抖动。
- mixed event storm：最终状态一致，无重复、乱序、短暂复活、白屏、滚动风暴。

## Segment Trim Oracle

通过条件：

- trim 后 item count 低于预算。
- visual anchor top delta <= 1px。
- scrollHeight 变化来自真实 DOM row 删除。
- hasMoreBefore/After 与被 trim 方向一致。

## Identity Remap Oracle

通过条件：

- local optimistic row 获得 server id 后，`identity-remap` modifier 显式携带 `from` / `to` identity 与 `previousKey -> nextKey`。
- 当前 visual anchor 经 remap 后仍能从 `previousKey` 解析到 committed DOM row `nextKey`。
- anchor top delta <= 1px。
- `viewportAnchorChanged(transaction-settle)` 发布 remap 后的 stable/server identity，不继续持久化 local-only id。
- duplicate / deleted / permission fallback 由 data modifier 解释，不由 viewport 猜测。

## Performance Oracle

通过条件：

- scroll frame 中无长任务。
- segment extend correction 在 data ready 后两帧内完成。
- ResizeObserver burst 被合并。
- diagnostics 数量受限，不因每个 scroll event 爆炸。
