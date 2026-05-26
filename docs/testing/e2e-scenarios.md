# E2E 场景矩阵

## P0 必须先绿

### `bootstrap.latest-native-bottom`

目的：latest bootstrap 使用真实 DOM 底部锁定。

步骤：

1. 打开 latest feed。
2. 等 viewport ready。
3. 采集 bottom marker rect。

期望：

- `hasMoreAfter=false`。
- bottom marker 在底部阈值内。
- `scrollHeight` 约等于真实 flow 内容高度。
- 没有 spacer evidence。

### `paging.before-native-thumb-rebound`

目的：向上触边加载后 thumb 自然回落。

步骤：

1. 滚到 before trigger。
2. 记录 anchor rect 和 native metrics。
3. 等 before page 返回。
4. 再采集 anchor rect 和 native metrics。

期望：

- exactly one `needMoreBefore`。
- anchor top delta <= 1px。
- `scrollHeight` 增加。
- `scrollTop` 被 anchor correction 推高。

### `paging.after-native-thumb-rebound`

目的：向下触边加载后不误判 latest。

期望：

- exactly one `needMoreAfter`。
- `hasMoreAfter=true` 时 bottomLockState 仍 UNLOCKED。
- thumb 从底部自然上移。

### `underflow.dual-edge-arbitration`

目的：短 segment 同时暴露 before / after trigger 时不会加载风暴。

期望：

- evidence 显示 `pendingIntent='underflow-fill'`，不是 user edge need。
- 同一 segmentRevision 最多一个 requestToken in flight。
- before / after 不会同 revision 同时请求。
- exhausted 后 underflow settle，不再循环重试。

### `identity.optimistic-server-remap`

目的：本地发送消息拿到 server id 后不破坏 anchor 与 row key。

期望：

- `identity-remap` modifier 带 old/new identity。
- visible row key 保持稳定，或 diagnostics 带 `previousKey -> nextKey`。
- anchor top delta <= 1px。
- persisted anchor 更新为 remap 后的 stable/server identity。

## P1 动态内容

### `dynamic-height.above-anchor-growth`

期望：

- dirty row 在 anchor 上方增高后，anchor top delta <= 1px。
- ResizeObserver 没有直接写 scrollTop。

### `dynamic-height.streaming-current-row`

期望：

- 当前 row 内容增长时 offsetWithinMessage 稳定。
- 不触发 reset。

## P2 目的地

### `destination.jump-in-segment`

期望：

- 不请求 around。
- local align / bounded motion 后目标可见。

### `destination.jump-outside-segment`

期望：

- 发 `needMessagesAround(reason: 'jump')`。
- reset around 后目标或 fallback 可见。

### `follow-bottom.partial-segment`

期望：

- `hasMoreAfter=true` 时发 latest need。
- pending 期间普通 after edge 被抑制。

## P3 生命周期

### `feed-switch.detach-anchor-checkpoint`

期望：

- detach 前发完整 `viewportAnchorChanged(reason: 'detach')`。
- 切回后 around restore，而不是复用旧 scrollTop。

### `strictmode.attach-detach-attach`

期望：

- refs 不泄漏。
- observers 不重复。
- stale generation events 被丢弃。

## P4 滚动条 overlay

### `scrollbar.overlay-native-mirror`

期望：

- overlay thumb position 可由 native metrics 计算。
- overlay 不读 edge state 来改变 track。

### `scrollbar.drag-edge-before`

期望：

- drag 到顶部触发 before need。
- 数据到达后 thumb 回落。

### `scrollbar.track-click-no-global-jump`

期望：

- track click 只在当前 loaded segment 内 page jump。
- 不跳到未加载历史百分比。
