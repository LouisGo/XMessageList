# Transaction 与滚动时序

本文定义 physical segment runtime 的 mutation 时序。任何改变 rows、spacer、segment、scrollTop rebase 或 anchor correction 的操作都必须进入 transaction。

## 1. Transaction Pipeline

```text
cancel or freeze conflicting writer
-> begin transaction
-> capture anchor / physical metrics
-> compute target projection
-> allocate nextSegmentRevision if physical geometry changes
-> publish snapshot
-> wait React commit ack
-> synchronous measurement
-> scrollTop correction or rebase
-> promote pending physical segment metrics
-> emit diagnostics
-> release transaction
```

禁止：

```text
scroll handler -> directly replace rows
ResizeObserver -> directly write scrollTop
data arrival -> directly expand scrollHeight
```

`segmentRevision` 必须在 projection publish 前分配，并贯穿 commit、measurement、rebase 和 diagnostics。commit 后不得再补增 revision；如果测量结果需要另一版几何，必须开启新的 `segmentRelayout` 并分配新的 revision。

## 2. Transaction Kinds

| Kind | Meaning |
| --- | --- |
| `bootstrap` | 初次构造 latest / restored / target segment。 |
| `segmentShift` | 切换到相邻或目标 physical segment。 |
| `segmentRelayout` | 不跨 segment，重建当前 segment 的 window/spacer。 |
| `projectionRefresh` | data patch 不改变 active segment 几何时刷新 active rows payload。 |
| `followBottom` | 确保 latest segment 并移动到底部。 |
| `jump` / `restore` | 解析目标数据，构造 target segment。 |
| `reset` | 清空当前几何状态，重新 bootstrap。 |

旧 `prepend` / `append` 不再是几何事务名称。它们是 data revision modifier。Runtime 只能在检查 pending intent、active logical bounds、render window keys 和 bottom-follow intent 后，选择 `segmentShift`、`segmentRelayout`、`projectionRefresh`、`followBottom` 或 no-op；禁止按 modifier 名称直接映射几何事务。

`projectionRefresh` 的边界必须收紧：它不得改变 `segmentRevision`、render window、spacer、`physicalWindowHeight`、`scrollTop` 或 bottom lock。只要需要任何几何变化，就必须改走 `segmentRelayout`、`segmentShift`、`followBottom`、`jump/restore` 或 `reset`。

## 3. Data Arrival Order

DataWindow arrival 只更新数据真相：

```text
setDataSnapshot
-> invalidate data-derived caches
-> if pending shift can now resolve: enqueue segmentShift
-> else if READY_FOLLOW_BOTTOM_PENDING can now resolve: enqueue followBottom
-> else if pending destination can resolve: enqueue jump/restore target segment
-> else if active segment range still valid: projectionRefresh
-> else: segmentRelayout
```

如果 `READY_SEGMENT_SHIFT_PENDING` 存在，目标数据到达后优先执行 `segmentShift`。不要再执行 legacy continuous-scroll anchor recovery，否则会重新把 spacer 绑定到全局数据高度。

如果 `READY_FOLLOW_BOTTOM_PENDING` 存在，latest data 到达后必须由 `followBottom` intent 消费。它的优先级高于普通 `append` refresh / relayout，避免最新页数据被当成当前 history segment 的 patch。

`active segment range still valid` 只表示当前 `logicalSegmentId`、logical bounds 和 render window item keys 仍可从 DataWindow 解析。它不允许因为 DataWindow 变长就扩张 scrollHeight，也不允许因为 prepend / append 到达就重算 spacer。

## 4. Segment Shift

```text
freeze scroll intent
set readySubstate READY_SEGMENT_SHIFTING
set viewportPhase SEGMENT_SHIFTING
confirm target data exists
build target PhysicalSegment
allocate nextSegmentRevision
publish target rows + local spacers + ProjectionCommitToken
wait commit ack for the same ProjectionCommitToken
measure mounted rows
rebase scrollTop to safe zone
promote pending segment metrics
commit anchor
set viewportPhase IDLE
set readySubstate READY_IDLE
release scroll intent
```

如果目标数据缺失：

```text
set readySubstate READY_SEGMENT_SHIFT_PENDING
emit needMoreBefore / needMoreAfter / needMessagesAround
keep current segment mounted
keep user inside safe boundary
```

shift 期间不能分帧 unmount/mount。目标 rows 和 spacers 必须同一个 projection commit 落地。

## 5. Segment Relayout

Relayout 是当前 segment 的几何重排：

```text
capture current anchor
compute new window inside same logical segment
allocate nextSegmentRevision
publish rows + local spacers + ProjectionCommitToken
wait commit ack for the same ProjectionCommitToken
measure anchor before/after
correct scrollTop by anchor delta
```

Relayout 不允许：

- 自动跨到相邻 segment
- 自动发起 pagination
- 把 history segment 标记为 latest
- 顺手设置 bottom lock
- 默认改变 `physicalWindowHeight`；只有 clientHeight 超过当前高度、short-feed 或 exceptional-row 语义才能改变它

Relayout 必须保持 `logicalSegmentId / logicalAnchorKey / logicalRole` 不变，render window 只能在 logical bounds 内移动。无法在 bounds 内恢复 coverage/cap 时，必须升级为 `segmentShift` 或 semantic command，不允许隐形跨段。

## 6. Bootstrap

Bootstrap 子状态：

```text
MOUNTING -> MEASURING -> STABILIZING -> READY
```

阶段许可：

| Phase | Allow | Forbid |
| --- | --- | --- |
| `MOUNTING` | mount rows, set local spacers | trim, correction, shift, follow-bottom |
| `MEASURING` | sync measure, cache height | shift, edge need, follow-bottom |
| `STABILIZING` | anchor correction only | shift, new data geometry mutation |

Latest bootstrap 构造 latest segment。Restored bootstrap 构造 target segment。两者都不能通过全局 scrollHeight 模拟目标距离。

## 7. Follow Bottom

`followBottom` 的目标是 feed latest，不是当前 physical bottom。

```text
if hasMoreAfter: emit needLatestMessages and enter READY_FOLLOW_BOTTOM_PENDING
when latest data arrives:
  build latest segment
  publish + commit + measure
  scroll to latest segment bottom
  set bottomLockState LOCKED
```

如果 latest 数据和普通 append 同帧到达，follow-bottom intent 优先消费该数据。

## 8. Jump / Restore

```text
resolve target in DataWindow
if missing:
  READY_DESTINATION_PENDING
  emit needMessagesAround
else:
  build target physical segment around anchor
  publish + commit + measure
  local anchor correction
  optional bounded motion inside target segment
```

禁止 motion engine 跨全局高度滚动到未挂载消息。

## 9. ScrollTop Writer Arbitration

唯一写入者原则：

| Writer | When |
| --- | --- |
| direct drag | `isDragLocked === true`，当前 segment 内线性写入；跨段只能通过 `DragSegmentHandoff` 事务。 |
| segment shift rebase | shift correction phase。 |
| anchor correction | relayout / bootstrap / restore correction phase。 |
| motion engine | target segment 已稳定后。 |
| follow-bottom instant write | reduced motion 或 motion disabled。 |

新 transaction 启动前必须同步取消 active motion。drag 期间不能启动无关 shift；只有 custom scrollbar drag 到达边界并由 runtime 接受 handoff 时，才允许在同一 drag session 内排队 `SegmentShift`。handoff 的 rebase 必须通过同一个 writer arbitration surface，不能和 direct drag pointer write 并发。

## 10. Commit Ack

Projection commit ack 使用完整 token：

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

- ack 必须匹配完整 `ProjectionCommitToken`。
- `ProjectionCommitToken.projectionRevision` 必须与 snapshot revision 同值。
- stale ack 丢弃。
- timeout 后不测量旧 projection。
- detach / destroy 取消 pending commit。
- segment shift timeout 必须恢复到上一稳定 segment 或 reset bootstrap。
- ack 之前不得把 pending segmentRevision 暴露为 committed physical metrics。

## 11. Diagnostics

每个 transaction 至少输出：

- `transaction.enqueue`
- `transaction.start`
- `transaction.commitWait`
- `transaction.measure`
- `transaction.correct`
- `transaction.complete`
- `transaction.error`

Segment transaction 还必须输出：

- `physical.segmentShift.pending`
- `physical.segmentShift.start`
- `physical.segmentShift.rebase`
- `physical.segmentShift.complete`
- `physical.segmentRelayout.start`
- `physical.segmentRelayout.complete`

Diagnostics 需要携带 transaction id、data revision、segment id/revision 和 scroll metrics。

Segment diagnostics 还必须显式携带：

- `scrollHeightCap`
- `capMode`
- `domScrollHeight`
- `physicalWindowHeight`
- `maxScrollPosition`
- `safeScrollRangeStart`
- `safeScrollRangeEnd`
- `realRowCoveragePx`
- `minRealRowCoveragePx`
- `isThumbFrozen`
- `pendingShiftDirection`
- `pendingEdgeOverflowPx`
- `isMomentumLatched`
- `suppressedMomentumDeltaPx`
- `segmentRelayoutState`
- `segmentRelayoutReason`
- `adjacentPrefetchBefore`
- `adjacentPrefetchAfter`
