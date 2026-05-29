# E2E 场景矩阵

执行入口：

- `npm run e2e:p0`：只跑 P0 场景。
- `npm run e2e:correctness`：跑 P0-P5 correctness lane。
- `npm run e2e:perf`：跑独立 perf lane。

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
2. 真实触发 runtime `needMoreBefore`，并在 mock response settle 前记录 anchor rect 和 native metrics。
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

步骤：

1. local optimistic row 进入 segment，后面保留 committed tail rows，确保该 row 可成为 visual anchor。
2. runtime local-align 到 optimistic row 后记录 before evidence。
3. server id 返回后发布 `identity-remap`。
4. 记录 after evidence 并验证 row / anchor / persisted anchor。

期望：

- `identity-remap` modifier 带 old/new identity 与 `previousKey -> nextKey`。
- remapped row 从 `previousKey` 解析到 `nextKey`。
- anchor top delta <= 1px。
- `viewportAnchorChanged(transaction-settle)` 更新为 remap 后的 stable/server identity。

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
- 目标消息位于视口中心附近，或受真实内容边界限制时位于最接近中心的位置。
- 目标消息高亮。

### `destination.jump-outside-segment`

期望：

- 发 `needMessagesAround(reason: 'jump')`。
- reset around 后目标或 fallback 可见。
- 目标消息位于视口中心附近。
- 原先远端 segment 不需要保留。
- 目标消息高亮。

### `destination.jump-cross-feed`

期望：

- 最终展示目标会话。
- 目标消息位于视口中心附近并高亮。
- 请求超过 200ms 时显示居中 overlay loading。
- 请求小于 200ms 时不显示 overlay loading。
- 不通过 before / after edge loading 逐页滚到目标。

### `destination.jump-visible-no-overlay`

期望：

- 目标已在当前视口内时不显示 overlay loading。
- 目标高亮。
- 列表不重建、不白屏、不触发分页。

### `destination.jump-interrupted-last-wins`

期望：

- 连续点击多个搜索 / 引用 / mention 目标时，最终停在最后一个目标。
- 旧目标请求完成后不能覆盖当前画面。
- 只有最后一个目标保持高亮。

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

### `scrollbar.held-drag-no-repeat-before`

期望：

- 用户按住 thumb 拖到顶部后，当前 before loading 未完成前只触发一次请求。
- thumb 可以停在边缘，但不闪烁、不抖动、不连续刷新 loading。
- 用户不需要释放 thumb 才能继续控制滚动条。

### `scrollbar.held-drag-rebound-continuity`

期望：

- before loading 完成后，thumb 从顶部自然回落到稳定位置。
- 同一次按住拖拽没有被取消、重启、锁死或替换。
- 如果用户继续向上拖动，thumb 从回落后的当前位置继续移动。
- 不出现“到顶 -> 回落 -> 下一帧又到顶 -> 再加载”的循环闪烁。

### `scrollbar.track-click-no-global-jump`

期望：

- track click 只在当前 loaded segment 内 page jump。
- 不跳到未加载历史百分比。

## P5 实时事件

### `live.append-locked-bottom`

目的：追底状态下，他人新消息和 Bot push 可以连续追加且保持底部稳定。

期望：

- 新消息按顺序出现在底部。
- bottom marker 仍在底部阈值内。
- 不出现先离底再回底的跳动。

### `live.append-unlocked-history`

目的：用户阅读历史时，他人新消息不打断当前阅读。

期望：

- 当前可见阅读消息 top delta <= 1px。
- 新消息不强行插入不连续历史段。
- latest / unread 提示可以更新，但列表不跳到底部。

### `live.reaction-visible-row`

目的：可见消息 reaction 更新就地呈现。

期望：

- reaction 状态更新到目标消息。
- 当前阅读位置稳定。
- 不触发 reset 或 scroll-to-latest。

### `live.edit-visible-row`

目的：可见消息编辑就地更新。

期望：

- 文本或 edited 标识更新。
- 如果行高变化，当前阅读位置稳定。
- 不表现成删除再插入闪烁。

### `live.delete-visible-middle`

目的：可见区域中间消息被删除时，阅读上下文稳定。

期望：

- 删除目标消失或变成明确 fallback / placeholder。
- 当前阅读位置稳定。
- 列表不跳到底部。

### `live.delete-loaded-outside-view`

目的：已加载但不可见消息删除时，不影响当前画面。

期望：

- 当前阅读位置稳定。
- scrollHeight 可以按真实 DOM 变化。
- 不出现可见跳动。

### `live.delete-unloaded-region`

目的：未加载区域删除不影响当前 loaded segment。

期望：

- 当前画面无可见变化。
- 当前 scroll range 不因为未加载删除被改写。
- 后续加载该区域时不出现已删除消息。

### `live.batch-delete-non-contiguous`

目的：非连续批量删除可以稳定收敛。

期望：

- 所有目标消息最终删除或 fallback。
- 可见区域内变化合并为稳定结果。
- 当前阅读位置稳定，不逐条删除造成连续抖动。

### `live.event-storm-mixed`

目的：append、edit、reaction、delete、Bot push 混合风暴下保持最终状态和阅读稳定。

期望：

- 最终画面与事件最终状态一致。
- 当前阅读位置稳定，除非场景包含本人发送消息。
- 无重复消息、短暂复活、乱序闪烁、白屏或滚动风暴。
