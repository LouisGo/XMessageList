# runtime-next 状态机审计报告（当前工作区/P5）

> 本报告只基于当前工作区 `src/runtime-next` 代码和
> `docs/architecture/runtime-next-state-machines.md` 的状态轴重画结果。
> 结论区分“已实现状态”“type-only 状态”和“由代码事实推出的风险”。

## 一、总评

P5 已经把 runtime-next 从 P4 的 transaction/data flow 推进到真实输入闭环：DOM input、ResizeObserver、custom scrollbar、direct scroll、wheel boundary、momentum latch、drag handoff、motion writer 和 physical metrics subscription 都接入了主循环。

状态机的总体方向是对的：React 仍只负责 projection render/ack；physical metrics、scroll writer、edge prefetch 和 high-frequency input state 由 runtime-next 管。当前最有价值的问题不是“图还不够多”，而是几条状态轴之间的提交边界还不够硬。

优先级结论：

1. **P0：transaction commit 原子性有破口**。segment revision 可能先 committed，scroll write 后失败，导致 projection / committed segment / metrics 分裂。
2. **P1：scroll interaction 状态不可证明**。drag、handoff、wheel momentum、segment shift pending 由多组 boolean 叠加表示，非法组合只能靠调用顺序避免。
3. **P1：bottom lock reconcile 没有单一 owner**。geometry promote、scroll frame、direct write、segmentShift settle 对 lock/metrics 的推进不在同一事务里。
4. **P1：pending semantic intent 缺少显式优先级和 writer-denied 策略**。reset、auto-scroll、jump、restore、follow、shift 的覆盖关系目前藏在 classifier 顺序和 abort 行为里。
5. **P2：adjacent prefetch 是 segment-relative 状态，但生命周期不完整**。`in-flight` 未实现，且 segment promotion 后没有统一按新 committed segment 重算。
6. **P2：destination / relayout / motion 还有 type-only 或半闭环状态**。这些未必是 P5 bug，但需要在文档和实现中继续隔离，避免被误当成已实现合同。

下面逐项展开。

## 二、P0：Transaction commit 原子性破口

### 代码事实

`RuntimeTransactionFlow.handleProjectionCommitted()` 的几何事务提交顺序是：

```text
prepareTransactionScrollTop()
-> revision.acknowledgeCommit(commit)
-> scrollWrite.commit()
-> promoteGeometry()
```

关键文件：

- `src/runtime-next/controller/transactionFlow.ts`
- `src/runtime-next/controller/transactionFlowScroll.ts`
- `src/runtime-next/geometry/segment/segmentRevision.ts`
- `src/runtime-next/controller/runtimeController.ts`

`revision.acknowledgeCommit()` 会立即把 pending physical segment 写成 committed segment，并清掉 revision controller 的 pending。之后如果 `scrollWrite.commit()` 返回失败，flow 会调用 `abort('writer-denied')`。

`#abortActive()` 会做这些事：

```text
flow.abortPending()
revision.abortPendingPublication()
writer.releaseTransaction()
inputCoordinator.handleTransactionAbort()
runner.abortActive()
```

但此时 revision controller 的 pending 已经被 `acknowledgeCommit()` 清掉，`abortPendingPublication()` 不能回滚刚刚 committed 的 segment。

### 状态机问题

TransactionFlow 图里的 `ack_revision -> commit_scroll -> abort_writer_denied` 是真实路径，但这条路径不是可逆路径。它从状态机角度跨过了两个 truth owner：

```text
projection ack 已确认 DOM render
physical segment revision 已 committed
scroll writer / metrics 尚未成功 promote
```

失败后会出现：

```text
ProjectionStore: restore 到事务前 stable snapshot
PhysicalSegmentRevisionController: 已指向新 committed segment
PhysicalMetricsStore: 仍是旧 metrics
```

这不是“少写一次 scrollTop”，而是 runtime 的 geometry truth 分裂。后续 segmentShift、active projection refresh、adjacent prefetch 和 diagnostics 都会从 committed segment 读到新段，但 UI projection 与 metrics 仍停在旧段。

### 建议

把 revision commit 改成真正两阶段：

```text
validate commit token
-> commit scrollTop / motion writer
-> commit pending physical segment
-> promote metrics/projection state
```

可选实现：

- 在 `PhysicalSegmentRevisionController` 增加 `validatePendingCommitToken(token)`，只校验 token，不 mutate。
- scroll writer 成功后再调用现有 `acknowledgeCommit()`。
- 或拆成 `prepareCommit(token)` / `commitPrepared(token)`，禁止在 scroll write 成功前推进 committed segment。

不建议用“失败后恢复 previous committed segment”补丁。当前 revision controller 没有 rollback 语义，补回滚会扩大状态面，并让 transaction abort 变成另一个隐式状态机。

## 三、P1：ScrollInteractionState 的 boolean 组合不可证明

### 代码事实

当前 `ScrollInteractionState` 用这些字段表达 input/shift 状态：

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

同一个 `isSegmentShiftPending=true` 可以来自：

- drag 到 safe edge，目标数据缺失；
- drag handoff 已接受，等待 segmentShift commit/settle；
- wheel momentum latch 已触发；
- ordinary segmentShift 已开始；
- data-driven pending segmentShift。

`completeSegmentShift()` 和 `abortSegmentShift()` 会同时清 thumb freeze、segment shift pending/shifting、momentum latch 和 suppressed delta。

### 状态机问题

这不是几个正交 boolean，而是至少三条互相约束的状态轴：

```text
pointer drag session: idle / dragging
edge handoff: none / waiting-data / frozen / settling
wheel momentum: idle / latched / shifting
```

当前图里 `dragging_edge_pending`、`drag_handoff`、`momentum_latched`、`segment_shift` 能画出来，但代码没有中心化 invariant 来保证组合只落在这些节点内。例如：

- `isThumbFrozen=true` 理论上只应该存在于 drag handoff，但类型层没有约束。
- `isMomentumLatched=true` 与 `isSegmentShifting=true` 的组合需要明确释放点。
- `isSegmentShiftPending=true` 不说明是 waiting data、active shift，还是 handoff freeze。
- `endDrag()` 只清 `isDragLocked`，不会清 edge pending / frozen / momentum，正确性依赖其他路径补齐。

### 建议

把主状态改为显式 mode，再从 mode 派生 metrics flags。可以是一条 discriminated union，也可以拆成两条小状态轴，但不要继续把 boolean 当主状态。

示例：

```ts
type ScrollInteractionMode =
  | { kind: 'idle' }
  | { kind: 'dragging' }
  | { kind: 'drag-edge-pending'; direction: SegmentShiftDirection; overflowPx: number }
  | { kind: 'drag-handoff'; direction: SegmentShiftDirection; overflowPx: number; phase: 'frozen' | 'settling' }
  | { kind: 'wheel-latched'; direction: SegmentShiftDirection; suppressedDeltaPx: number; phase: 'waiting-data' | 'shifting' }
  | { kind: 'programmatic-shift'; direction: SegmentShiftDirection; source: 'data' | 'keyboard' | 'edge' };
```

迁移原则：

- `PhysicalScrollMetrics` 继续暴露旧 flags 可以接受，但 flags 应从 mode 计算，不作为 truth。
- settle/abort 只允许作用在匹配 mode 上；不匹配时记录 diagnostic。
- diagnostics 输出 mode，避免只输出一组难以解释的 boolean。

## 四、P1：BottomLockState 没有单一 reconcile owner

### 代码事实

当前 bottom lock 有两个真实写入入口：

- geometry promote：`canPromoteBottomLock()` 决定 `LOCKED/UNLOCKED`，然后 publish projection。
- scroll frame：`reconcileBottomLockFromScroll()` 根据 committed segment、data、metrics、scrollState patch projection state。

direct scroll / custom scrollbar write 当前只做：

```text
writer.writeScrollTop()
-> setCurrentScrollTop()
-> metrics.patchScrollPosition()
```

它不直接调用 `reconcileBottomLockFromScroll()`。

segmentShift settle 下一帧也只做：

```text
completeSegmentShift()
-> metrics.patchFlags()
-> record settle diagnostic
```

它同样不重新 reconcile bottom lock。

### 状态机问题

状态图里 `BottomLockState` 看起来是由“是否在底部”决定，但当前代码实际是由“某些路径是否调用了 lock reconcile”决定。

这会产生两个滞后窗口：

1. custom scrollbar / direct scroll 已经同步改变 metrics.scrollPosition，但 projection.bottomLockState 要等真实 scroll event + rAF 才更新。
2. segmentShift promote 时因为 `isSegmentShiftPending/isSegmentShifting=true` 通常不会 lock；下一帧 settle 清 flags 后，没有同步重新计算 lock。

真实浏览器通常会发 scroll event，所以第一类问题可能只持续一帧。但从状态机角度看，direct write 是 runtime 自己发起的 scroll mutation，不能把 lock 正确性外包给后续 DOM event。

### 建议

把 lock reconcile 收敛成一个 pure resolver，并要求所有 scrollPosition 或 shift-flight 状态 mutation 都通过它：

```text
scrollPosition mutation
-> metrics update
-> resolveBottomLockState(input)
-> update runtime lock cache + projection patch/publish
```

建议拆分：

- `resolveBottomLockState({ data, segment, metrics, interactionMode, source })`
- `applyBottomLock(next, mode)`，其中 `mode` 区分 `publish` 与 `patchState`

调用点至少包括：

- geometry promote；
- scroll frame；
- direct scroll write 成功后；
- segmentShift settle 清 flags 后。

如果某些来源不能触发 attach/follow，例如 programmatic rebase 或 active drag，需要用 `source` 明确表达，而不是依赖事件时序。

## 五、P1：Pending intent 优先级和 writer-denied 策略不显式

### 代码事实

data arrival classifier 的优先级是：

```text
reset
-> auto-scroll-to-bottom
-> pendingDataIntent
-> active projection refresh / relayout
```

因此：

- `reset` 永远压过 pending jump/restore/follow/shift。
- `auto-scroll-to-bottom` 永远先于 pending jump/restore/follow/shift。
- `auto-scroll-to-bottom + hasMoreAfter=true` 会把 pending intent 写成 followBottom。

另外，writer denied 的处理是 transaction abort。除 `segmentShift` missing target data 和 relayout recovery 这类显式 defer 路径外，abort 不会根据原始 semantic intent 自动恢复 `pendingDataIntent`。

### 状态机问题

当前 `PendingDataIntent` 图只有 pending/enqueue/no-pending，没有表达这些策略：

- hard reset 是否取消所有 user destination？
- user jump/restore 是否应该压过 business auto-scroll hint？
- followBottom command 与 auto-scroll-to-bottom data hint 是否同级？
- drag/wheel edge pending 与 ordinary append refresh 谁优先？
- writer 被 direct-drag 占用时，哪些 intent 应该 drop、哪些应该 retry、哪些应该取消 drag？

现在这些答案散落在 classifier 顺序、command helper、transaction abort 和测试期望里。状态机没有独立政策层，后续接更多来源时很容易出现“不是 crash，但用户意图被另一个 hint 覆盖”的问题。

### 建议

给 pending intent 增加 origin / priority / cancellation policy：

```ts
type PendingDataIntent =
  | { kind: 'jump'; origin: 'user'; priority: 'destination'; target: MessageIdentityAnchor }
  | { kind: 'restore'; origin: 'lifecycle'; priority: 'destination'; target: MessageIdentityAnchor | AnchorState }
  | { kind: 'followBottom'; origin: 'user-command' | 'auto-scroll-hint'; priority: 'latest' }
  | { kind: 'segmentShift'; origin: 'drag' | 'wheel' | 'data'; priority: 'edge'; direction: SegmentShiftDirection };
```

再把 classifier 改成显式 policy table：

```text
incoming reset + pending destination
incoming auto-scroll + pending destination
incoming auto-scroll + active drag writer
incoming data ready + pending shift
writer denied + user command
writer denied + auto-scroll hint
```

最低限度应补测试：

- pending jump + auto-scroll-to-bottom data；
- pending restore + reset data；
- pending segmentShift + auto-scroll-to-bottom data；
- user followBottom / jump 在 direct-drag writer active 时的处理；
- auto-scroll hint 在 direct-drag writer active 时是否应 drop。

## 六、P2：AdjacentPrefetchState 生命周期不完整且可能相对 segment 滞后

### 代码事实

类型允许：

```text
idle | needed | in-flight | ready
```

当前写入路径只有：

- `needed`：`emitAdjacentPrefetchNeed()` 发 need 后 patch；
- `ready`：`syncAdjacentPrefetchState()` 判断当前 committed segment 的相邻数据已存在；
- `idle`：初始、无更多数据、或无 active segment。

没有代码写 `in-flight`。

更重要的是：`syncAdjacentPrefetchState()` 只在 `setDataSnapshot()` 后调用。geometry promotion 时，`resolveScrollFlagsForPromotion()` 把旧 metrics 上的 `adjacentPrefetchBefore/After` 原样带入新 metrics。

### 状态机问题

`adjacentPrefetchBefore/After` 是相对 committed segment 的状态，不是全局 feed 状态。segmentShift commit 后，当前 segment 已经变了，before/after 的含义也随之变了。

但当前状态机没有这个转换：

```text
committed segment changes
-> recompute adjacent prefetch relative to new segment
```

因此可能出现 metrics flag 与新 committed segment 不匹配。例如旧 segment 的 `after=ready` 在 shift after 后被带到新 segment；但对新 segment 来说，after 可能应该是 `idle`、`needed` 或另一段 `ready`。

这不会直接阻断 need event，因为 edge need latch 还会按新 physical segment revision 去重。但 diagnostics、custom scrollbar 扩展、未来 prefetch UI 或 retry policy 会读到不可靠状态。

### 建议

把 adjacent prefetch 状态的 owner 改成“data + committed segment + host request lifecycle”的派生结果。

短期：

- segment promote 后调用一次基于新 segment 的 `syncAdjacentPrefetchState()` 等价逻辑。
- 或在 `resolveScrollFlagsForPromotion()` 内根据 pending segment 与 current data 重算 before/after，不复制旧 flag。

中期：

- 如果 runtime 不接收 host ack，就把 `in-flight` 标为 future/type-only，不让外部把它当合同。
- 如果要实现 `in-flight`，需要 host ack 或 request lifecycle event：

```text
near edge -> needed
host accepted request -> in-flight
data satisfies adjacent segment -> ready
host exhausted/failed/no-more -> idle or error
segment promotion -> recompute relative before/after
```

## 七、P2：Destination settle 没有闭环事件

### 代码事实

`RuntimeNextViewportEvent` 定义了 `destinationSettled`，但当前没有发射点。`ViewportPhase` 对 jump/restore 的实现是：

```text
publish -> DESTINATION_PENDING
promoteGeometry -> IDLE
```

writer denied、missing data、timeout、commit token mismatch 等失败路径也不会发 destination settle/cancel 事件。

### 状态机问题

从 projection 状态看，destination 只从 `DESTINATION_PENDING` 回到 `IDLE`。外部无法通过事件区分：

- target 已命中；
- fallback target 被使用；
- 目标还缺数据并继续 pending；
- transaction abort；
- writer denied。

如果 P5 不承诺 destination completion callback，这不是 bug；但它不能和已实现事件混在一起。当前类型已经暴露 `destinationSettled`，状态机却没有闭环。

### 建议

二选一：

- 短期：在状态机和 API 文档中明确 `destinationSettled` 是 type-only/future event。
- 中期：在 jump transaction 成功 promote 后发 `destinationSettled(resolution='target')`；失败/取消路径至少发 diagnostic，必要时发 cancelled 事件或保持 pending policy。

## 八、P2：SegmentRelayoutState 仍是 type-only，resize reason 合并过弱

### 代码事实

`segmentRelayoutState` 类型允许：

```text
idle | pending | running
```

当前实际写入保持 `idle`。ResizeObserver 只做 microtask coalesce，然后 enqueue `segmentRelayout`。

coalesce 逻辑只保留第一个 reason：

```text
if pendingResizeRelayoutReason !== null return
pendingResizeRelayoutReason = reason
```

### 状态机问题

这里有两个层级：

1. `segmentRelayoutState` 出现在 physical metrics 中，但不能表达 pending/running；diagnostics 消费方会被误导。
2. 同一 microtask 内如果先 row measurement 后 container resize，后者 reason 会被忽略。几何上仍会 relayout，但 diagnostic reason 不准。

### 建议

短期：

- 文档继续标注 `segmentRelayoutState.pending/running` 为 type-only。
- 不要在 UI 或 host integration 中依赖该字段。

中期：

```text
observer schedules relayout -> pending
segmentRelayout transaction starts -> running
promote/abort -> idle
```

reason 合并可以用优先级或 reason set：

```text
resize > measurement
```

或：

```ts
pendingResizeRelayoutReasons: Set<'resize' | 'measurement'>
```

## 九、P2：Drag handoff settle 重获 writer 未检查

### 代码事实

drag handoff 开始时会释放 `direct-drag` writer，enqueue `segmentShift(source='drag-handoff')`。segmentShift commit/abort 后，下一帧 settle：

```text
completeSegmentShift()
patch flags
if source is drag-handoff and drag still locked:
  writer.acquire(direct-drag)
  record complete/abort diagnostic
```

`writer.acquire()` 的返回值没有检查。

### 状态机问题

状态机图里 `handoff_frozen -> drag_owned` 暗含“重新拿回 direct-drag writer”。但代码只尝试 acquire，并无成功/失败分支。

如果 settle frame 前后有新的 writer owner，状态会变成：

```text
isDragLocked=true
isThumbFrozen=false
writer owner != direct-drag
```

下一次 pointermove 仍会走 direct drag write，但 writer arbitration 会拒绝。用户看到的是 drag 还没结束，但滚动不响应。

### 建议

settle 时检查 acquire 结果：

- 成功：进入 `dragging`，记录 handoff complete。
- 失败：进入 `drag-lock-stolen` 或直接 end drag，并记录 diagnostic。

这条改动最好和 ScrollInteractionMode 一起做，否则仍会在 boolean 组合里补洞。

## 十、P3：Motion 状态名与当前实现语义不一致

### 代码事实

`ScrollMotionEngine` 当前是同步 bounded write：

```text
prepare
-> acquire motion writer
-> commit
-> record motion.start
-> write scrollTop synchronously
-> record motion.settle
-> release writer
```

`ViewportPhase.MOTION_ACTIVE` 没有写入路径。`motion.isActive()` 只在 prepare 成功到 commit/cancel 之间可观测，当前调用链里几乎不是一个长期状态。

### 状态机问题

这不是 correctness bug，但命名会误导后续实现。状态机图中如果把它画成真实 async motion，会错误传播。

### 建议

二选一：

- 如果 P5 只需要同步 bounded write，把它命名为 `BoundedScrollWriter` / `TargetScrollWriter`，并继续把 `MOTION_ACTIVE` 标为 type-only。
- 如果后续要真实动画，则补完整 async state：

```text
prepared -> active -> settling
active -> cancelled
active -> interrupted
```

同时明确 projection phase、writer ownership、abort/cancel 边界。

## 十一、不是当前 bug，但必须防止误画

这些状态目前只能作为 future/type-only 处理：

- `BootstrapState.MEASURING`
- `BootstrapState.STABILIZING`
- `ViewportPhase.MOTION_ACTIVE`
- `PhysicalScrollMetrics.segmentRelayoutState: pending/running`
- `AdjacentPrefetchState.in-flight`
- `RuntimeNextViewportEvent.destinationSettled`
- `ViewportAnchorChangedEvent.reason='scroll-idle' | 'transaction-settle'`
- `segmentShift source='edge' | 'keyboard'`

这些类型存在不等于运行时存在。后续文档、测试和 API 说明必须继续区分，否则会把未实现能力扩散成外部合同。

## 十二、建议执行顺序

1. **先修 transaction commit 原子性**。这是 correctness 问题，优先级最高。
2. **收敛 ScrollInteractionState**。用显式 mode 或少量正交状态轴替代 boolean truth。
3. **统一 bottom lock reconcile owner**。direct write、scroll frame、geometry promote、segmentShift settle 都走同一 pure resolver。
4. **补 pending intent policy**。把 reset、auto-scroll、user destination、follow、shift、writer-denied 的覆盖关系写成可测试规则。
5. **重算 adjacent prefetch 相对状态**。segment promotion 后必须相对新 committed segment 计算 before/after。
6. **整理 type-only 状态**。要么实现闭环，要么从文档主路径和外部合同中降级为 future field。

按这个顺序处理后，runtime-next 的状态机会从“P5 初步跑通”变成“可以继续扩展而不靠时序运气”的基座。
