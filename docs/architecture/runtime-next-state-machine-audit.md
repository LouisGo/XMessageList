# runtime-next 状态机审计报告（P5 优化落地后）

> 本报告基于当前工作区 `src/runtime-next` 代码和
> `docs/architecture/runtime-next-state-machines.md`。
> 重点记录本轮已收敛的状态机风险，以及仍不能误画成已实现能力的 type-only 状态。

## 一、总评

本轮已经完成状态机审计中优先级最高的一组优化：

1. transaction commit 原子性已经收敛：scroll writer 成功前不再提升 committed segment。
2. scroll interaction 的内部 truth 已从多 boolean 改为 `ScrollInteractionMode`，metrics flags 变成派生输出。
3. bottom lock 统一到同一套 resolver，direct scroll / scroll frame / geometry promote / segmentShift settle 都按同一条件收敛。
4. pending intent 已带 origin/priority，pending destination/edge intent 不再被 auto-scroll hint 隐式覆盖。
5. adjacent prefetch 在 geometry promotion 时按新 committed segment 重算，不再把旧 segment 的 before/after 状态直接带入新 segment。

当前 runtime-next 的状态机已经从“P5 初步跑通”进入“可继续扩展的 P5 基座”。后续真正需要关注的是 type-only 状态是否要实现闭环，而不是再修补 P0/P1 的基础状态破口。

## 二、已修复：Transaction commit 原子性

当前几何事务提交顺序是：

```text
prepareTransactionScrollTop()
-> validatePendingCommitToken()
-> scrollWrite.commit()
-> revision.acknowledgeCommit()
-> promoteGeometry()
```

关键点：

- `validatePendingCommitToken()` 只校验 pending token，不改变 committed segment。
- `scrollWrite.commit()` 失败时，revision controller 仍保留 pending publication，abort 可以恢复 stable projection 并清 pending。
- `acknowledgeCommit()` 只在 scroll write 成功后调用。

这消除了旧路径里的三者分裂风险：

```text
ProjectionStore restored
PhysicalSegmentRevisionController already committed
PhysicalMetricsStore still old
```

新增覆盖：

- `segmentRevision.test.ts` 验证 token validation 不提交 segment。
- P4/P5 runtime tests 继续覆盖 commit ack、writer denied、projection restore 和 metrics promotion。

## 三、已修复：ScrollInteractionState boolean 组合不可证明

`ScrollInteractionState` 当前内部状态是 `ScrollInteractionMode`：

```text
idle
dragging
drag-edge-pending
drag-handoff
wheel-latched
segment-shift-pending
segment-shift
```

`PhysicalScrollMetrics` 仍对外暴露原 flags：

```text
isDragLocked
isThumbFrozen
isSegmentShiftPending
pendingShiftDirection
pendingEdgeOverflowPx
isSegmentShifting
isMomentumLatched
suppressedMomentumDeltaPx
```

但这些 flags 现在由 mode 派生，不再作为 truth 存储。这样可以防止后续出现“thumb frozen 但不是 drag handoff”“momentum latched 但释放点不明”之类的非法组合。

已覆盖行为：

- drag handoff freeze / settle；
- wheel momentum latch / residual suppress / release；
- segment shift commit/abort 后清理 flags；
- drag handoff settle 前保持 direct-drag writer ownership。

## 四、已修复：BottomLockState 多入口不一致

当前 bottom lock 由 `resolveBottomLockState()` 统一判断：

```text
data exists
segment role is latest or short-feed
hasMoreAfter is false
no segment shift in-flight
distanceToBottom <= 16
source allows lock
```

调用点：

- geometry promote：只有 `followBottom` promotion 允许直接 lock。
- scroll frame：按真实 metrics reconcile。
- direct scroll write：写入 scrollPosition 后立即 reconcile。
- segmentShift settle：清 shift flags 后立即 reconcile。

projection patch 有额外保护：只有 bottom lock 实际变化时才 `patchState()`，避免 high-frequency physical scroll 触发 row projection subscription。

新增覆盖：

- P5 测试覆盖 direct scroll 离底后立即把 `bottomLockState` 从 `LOCKED` 变为 `UNLOCKED`。
- P4 测试继续保证 direct physical scroll 在 lock 未变化时不触发 projection changes。

## 五、已修复：Pending intent 优先级显式化

`PendingDataIntent` 当前带有：

```text
origin
priority
```

已实现策略：

- `reset` 仍是最高优先级，会取消 pending intent。
- 已存在 pending intent 优先于 `auto-scroll-to-bottom`。
- `auto-scroll-to-bottom` 不再覆盖 pending jump/restore/segmentShift。
- `followBottom` 区分 `user-command` 与 `auto-scroll-hint`。
- writer-denied 后只恢复 user follow / destination / edge shift 语义；auto-scroll hint 不被提升成延迟强制跟随。

新增覆盖：

- classifier 测试覆盖 pending destination 不被 auto-scroll-to-bottom 覆盖。
- P4 仍覆盖 active drag writer 阻止 followBottom promotion。

## 六、已修复：AdjacentPrefetchState 相对 segment 滞后

`adjacentPrefetchBefore/After` 当前仍只有：

```text
idle | needed | ready
```

`in-flight` 仍未实现。

本轮修复的是 segment-relative 生命周期：

- data snapshot 到达后，按当前 committed segment 同步 adjacent prefetch state。
- geometry promotion 时，按即将 committed 的新 segment 重新计算 before/after。
- 如果 segmentId 未变化，可以保留旧方向状态；如果 segment 改变，不再复制旧 segment 的 ready/needed。

这避免了 segmentShift 后把旧 segment 的 `after=ready` 误带到新 segment。

## 七、仍是 type-only / future 的状态

以下状态仍不能画入主路径，也不能作为外部合同：

- `BootstrapState.MEASURING`
- `BootstrapState.STABILIZING`
- `ViewportPhase.MOTION_ACTIVE`
- `PhysicalScrollMetrics.segmentRelayoutState: pending/running`
- `AdjacentPrefetchState.in-flight`
- `RuntimeNextViewportEvent.destinationSettled`
- `ViewportAnchorChangedEvent.reason='scroll-idle' | 'transaction-settle'`
- `segmentShift source='edge' | 'keyboard'`

其中 `destinationSettled`、`segmentRelayoutState.pending/running`、`AdjacentPrefetchState.in-flight` 是后续最容易被误用的三个字段。

## 八、后续建议

1. 如果要支持真正的 destination completion callback，再实现 `destinationSettled` 的成功/失败/取消闭环。
2. 如果 diagnostics 或 UI 需要 relayout 进度，再实现 `segmentRelayoutState: pending/running`；否则保持 type-only 标注。
3. 如果 host request lifecycle 要进入 runtime，再补 `AdjacentPrefetchState.in-flight` 的 host ack / fail / exhausted 事件。
4. 如果 motion 要从同步 bounded write 升级成动画，再补 `MOTION_ACTIVE`、cancel/interruption 和 projection phase 语义。
5. resize reason 合并仍是 first-wins；如果 diagnostics 精度变重要，再改成 reason priority 或 reason set。

当前不建议继续扩大状态面。下一步应优先围绕 P6 集成路径验证这些已收敛状态在真实 React/demo 使用中的稳定性。
