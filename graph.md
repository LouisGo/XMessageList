基准：当前 `HEAD 51098e4`。本文件按最新 `src/runtime` 刷新，旧基准 `226231d` 的图已不再准确；`04d3f51` 之后新增的 ready reattach edge flush 也已纳入。

**1. 总体架构图**

```mermaid
flowchart TB
  React["React adapter<br/>useSyncExternalStore + layout commit ack"] --> Facade["MessageViewportRuntime<br/>public facade"]
  Facade --> Controller["MessageViewportRuntimeController"]
  Controller --> Compose["createRuntimeControllerServices<br/>composition root"]

  Data["setDataSnapshot(snapshot)"] --> DataCoord["RuntimeDataSnapshotCoordinator"]
  Cmd["dispatch(command)"] --> Router["RuntimeCommandRouter"]
  DOMInput["DOM scroll / resize / direct scrollbar"] --> Frame["ScrollFrame + ResizeStabilization"]
  CommitAck["notifyProjectionCommitted(feed,generation,revision)"] --> Commit["CommitCoordinator"]

  Compose --> Axes["LifecycleGuard + RuntimeStateAxes<br/>state / readySubstate / phase / destination"]
  Compose --> DataCoord
  Compose --> Router
  Compose --> TxRunner["TransactionRunner<br/>serialized queue + onIdle hook"]
  Compose --> TxCtl["ViewportTransactionController"]
  Compose --> Projection["ProjectionCoordinator<br/>revisioned snapshot builder"]
  Compose --> Edge["EdgeNeedCoordinator<br/>needMore + edge status projection"]
  Compose --> Intent["DestinationIntentCoordinator<br/>followBottom / jump / restore"]
  Compose --> Compact["ViewportCompactionCoordinator<br/>spacer + DataWindow budget"]
  Compose --> Engines["DOM engines<br/>Registry / Anchor / Measurement / RenderWindow / Spacer / ScrollIntent / Motion"]

  DataCoord --> TxRunner
  Router --> Intent
  Router --> Edge
  Frame --> TxRunner
  Frame --> Edge
  Frame --> Projection
  Intent --> TxRunner
  Compact --> TxRunner
  TxRunner --> TxCtl
  TxCtl --> Projection
  TxCtl --> Commit
  TxCtl --> Engines

  Edge -. "status override + guarded publish" .-> Projection
  TxRunner -. "onIdle flushDeferredEdgeState" .-> Edge
  Projection --> Store["ProjectionStore<br/>external store snapshot"]
  Store --> React
  Engines --> Events["Runtime events + diagnostics"]
```

核心变化：edge loading/error 已进入 runtime projection，但不再无条件抢发。edge status override 会先记录在 `ProjectionCoordinator` 内，随后标记 dirty；只有 runtime 处于 READY、没有 pending transaction、bootstrapState 为 READY，且当前 projection window 与 data window 对齐时，才会写入 ProjectionStore。事务队列空闲时由 `TransactionRunner.onIdle` flush。

**2. 数据进入 runtime 后的路由**

```mermaid
flowchart TD
  A["setDataSnapshot(snapshot)"] --> G{"feed/generation changed?"}
  G -- yes --> GR["resetForGeneration<br/>clear tx + commit wait + motion + latches<br/>publish empty snapshot"]
  G -- no --> R{"data revision changed?"}
  R -- yes --> IC["invalidate render-window index cache"]
  R -- no --> Save["save data snapshot"]

  GR --> Save
  IC --> Save
  Save --> D0["emit data diagnostics<br/>including window budget warning"]
  D0 --> BL{"hasMoreAfter while bottom locked?"}
  BL -- yes --> Unlock["unlock bottom lock"]
  BL -- no --> EdgeResolve["resolve edge status from data/modifier"]
  Unlock --> EdgeResolve

  EdgeResolve --> DropSlide{"modifier != none?"}
  DropSlide -- yes --> Drop1["drop window-slide queued tx"]
  DropSlide -- no --> Reserved{"reserved modifier?"}
  Drop1 --> Reserved
  Reserved -- yes --> Drop2["drop data-refresh queued tx"]
  Reserved -- no --> P0{"pending bootstrap?"}
  Drop2 --> P0

  P0 -- yes --> Boot["tryRunPendingBootstrap"]
  P0 -- no --> P1{"pending followBottom?"}
  P1 -- yes --> Follow["need latest rebuild<br/>or enqueue followBottom tx"]
  P1 -- no --> P2{"pending jump/restore?"}
  P2 -- yes --> Dest["need around-target rebuild<br/>or enqueue jump/restore tx"]
  P2 -- no --> P3{"pending viewport compaction?"}
  P3 -- yes --> CompactPending["need around-anchor rebuild<br/>or enqueue compaction tx"]
  P3 -- no --> Ready{"state INITIAL/ATTACHED?"}
  Ready -- yes --> Stop["return"]
  Ready -- no --> Auto{"auto-scroll-to-bottom?"}

  Auto -- yes --> ActiveFollow["ensure active follow-bottom intent"]
  Auto -- no --> Budget{"can start viewport compaction?<br/>prepend/append + budget + READY_IDLE + anchor"}
  ActiveFollow --> Budget
  Budget -- yes --> StartCompact["start pending viewport compaction<br/>emit needMessagesAround"]
  Budget -- no --> Mod{"viewportModifier"}

  Mod -- prepend --> Prepend["enqueue prepend tx"]
  Mod -- append/auto-scroll-to-bottom --> Append["enqueue append tx"]
  Mod -- remove-from-start --> Remove["enqueue remove-from-start tx"]
  Mod -- item-location --> ItemLoc["enqueue item-location tx"]
  Mod -- identity-remap --> Rebind["enqueue identity-rebind tx"]
  Mod -- anchor-risk --> AnchorRisk["enqueue anchor-risk tx"]
  Mod -- reset --> Reset["enqueue reset tx"]
  Mod -- none/items-change/default --> Refresh["enqueue projection refresh tx"]
```

关键点：当前路由优先级本身就是架构规则，不是可随意重排的 if/else。snapshot 接收、generation reset、edge resolve 之后，必须先处理 pending bootstrap，再处理 pending followBottom，再处理 pending jump/restore，再处理 pending compaction，最后才进入普通 modifier。DataWindow item budget 已经和 spacer budget 一起参与 destination rebuild 与 compaction 判断；但 compaction 真正启动还要求 READY_IDLE、bottom 未锁定、非 generation change，并且能捕获 committed viewport anchor。

**3. 事务与 projection commit 时序**

```mermaid
sequenceDiagram
  participant Entry as Data/Command/Scroll/Resize
  participant Runner as TransactionRunner
  participant Motion as DestinationMotionCoordinator
  participant Tx as ViewportTransactionController
  participant Projection as ProjectionCoordinator
  participant React as React adapter
  participant Commit as CommitCoordinator
  participant DOM as DOM/Measurement/Anchor
  participant Edge as EdgeNeedCoordinator

  Entry->>Runner: enqueue(kind, supersedeKey)
  Runner->>Motion: cancel(transaction-supersede)
  Runner->>Tx: run one transaction at a time
  Tx->>Projection: publish(PROJECTING/MOUNTING/etc)
  alt projection changed
    Projection-->>React: ProjectionStore snapshot revision++
    React-->>Commit: ack exact feed/generation/revision
    Commit-->>Tx: wait resolves
  else projection unchanged
    Commit-->>Tx: waitForChanged returns immediately
  end
  Tx->>DOM: read mounted rows / measure / capture anchor
  alt anchor-preserving correction
    Tx->>Motion: writeScrollTop(delta, programmatic/recovery)
    Tx->>Projection: publish(IDLE)
  else jump/followBottom animated destination
    Tx->>Motion: start(targetTop)
    Motion->>Projection: publish(MOTION_ACTIVE)
    Motion->>Projection: publish(IDLE after real scroll settles)
  end
  Runner-->>Runner: active=false
  alt queue empty
    Runner->>Edge: onIdle flushDeferredEdgeState()
  end
```

正确性边界仍然是：projection 变化后必须等 React commit ack，之后才读 DOM。`CommitCoordinator` 只接受精确 revision ack；旧 commit 不能唤醒新事务。

**4. edge 状态发布时序**

```mermaid
sequenceDiagram
  participant User as User scroll / command
  participant Edge as EdgeNeedCoordinator
  participant Runner as TransactionRunner
  participant Projection as ProjectionCoordinator
  participant Store as ProjectionStore
  participant React as React adapter

  User->>Edge: near edge or setEdgeStatus
  Edge->>Projection: setEdgeStatus override
  alt status unchanged
    Edge-->>User: return without publish
  else status changed
    Edge->>Edge: edgeProjectionDirty = true
    Edge->>Edge: publishCurrentEdgeState()
    alt READY + no pending transaction + bootstrap READY + projection aligned
      Edge->>Projection: publish same window with updated edgeState
      Projection->>Store: revision++
      Store-->>React: render edge loading/error/idle
      Edge->>Edge: dirty=false
    else transaction active / detached / not aligned
      Edge-->>Edge: keep dirty, do not publish
    end
  end

  Runner-->>Edge: onIdle flushDeferredEdgeState()
  Edge->>Edge: retry publishCurrentEdgeState()
```

补充：ready runtime detach 后收到 `setEdgeStatus` 不会立刻改 snapshot；reattach 时 lifecycle 会 `flushCurrentEdgeState()`，把仍有效的 edge override 发布出来。

**5. lifecycle 状态模型**

```mermaid
stateDiagram-v2
  [*] --> INITIAL
  INITIAL --> ATTACHED: attach
  ATTACHED --> BOOTSTRAPPING: non-empty bootstrap tx starts
  ATTACHED --> READY: empty bootstrap publishes READY_EMPTY
  BOOTSTRAPPING --> READY: viewportReady / READY
  READY --> DETACHED: detach
  DETACHED --> READY: attach when snapshot bootstrapState is stable
  DETACHED --> ATTACHED: attach when bootstrap is not stable
  READY --> ATTACHED: generation reset with container
  READY --> INITIAL: generation reset without container
  INITIAL --> DESTROYED: destroy
  ATTACHED --> DESTROYED: destroy
  BOOTSTRAPPING --> DESTROYED: destroy
  READY --> DESTROYED: destroy
  DETACHED --> DESTROYED: destroy
```

`RuntimeState` 只表达生命周期。`readySubstate`、`viewportPhase`、`transactionState`、`destinationState`、`bottomLockState`、motion active、edgeState 都是正交轴，不能只看 `READY` 推断滚动、跳转、加载或 commit 已完成。

**6. destination 语义分层**

```mermaid
flowchart LR
  Follow["followBottom<br/>持续约束<br/>用户仍在底部时持续追 latest"] --> PendingFollow["PendingFollowBottomTracker<br/>等待 latest rebuild"]
  Follow --> ActiveFollow["ActiveFollowBottomIntentTracker<br/>motion / resize / append 期间保留追底意图"]

  Jump["jump<br/>一次性目的地<br/>到达后 settled"] --> PendingDest["pendingDestinationRequest<br/>等待 around-target rebuild"]
  Restore["restore<br/>历史位置恢复<br/>等待目标 / deleted anchor fallback"] --> PendingDest

  PendingDest --> JumpTx["jump tx<br/>可 motion"]
  PendingDest --> RestoreTx["restore tx<br/>同步 anchor correction"]
```

这里仍是最容易发生 semantic drift 的位置：followBottom、jump、restore 被同一个 `DestinationIntentCoordinator` 管理，但产品语义不同。现在代码有 tracker 分层，`jump/restore` 仍共享 pending destination 通道，但消费分支必须显式分开：

- `followBottom` 是持续约束，绑定当前 `feedId + generation`，在用户仍要求追底时跨 append / resize / refresh 继续追到 latest bottom。
- `jump` 是当前 active feed 内的一次性目的地命令。目标不在 DataWindow 时只请求 around-target rebuild，目标到达后可按 origin 执行 bounded motion，也可以直接落位。
- `restore` 是当前 active feed 内的历史位置恢复。它不启动 motion，不进入 `motionActive`，只做同步 anchor correction。

跨 feed 的 mention / search / navigation 入口不属于 viewport runtime 判定范围。外层 conversation / session host 必须先选择目标 feed/runtime，再决定向该 active runtime 派发 `restore` 还是 `jump`；runtime command 本身不携带 feed 切换语义。

**7. 当前架构判断**

1. 相较旧图，当前图已补充 DataWindow item budget、edgeState projection、deferred edge publish、READY_EMPTY/unread bootstrap、reattach edge flush；这些是当前 runtime 的关键事实。

2. 最高风险已从“edge projection 可能打断事务 commit wait”降级。当前主路径通过 `canPublishEdgeState`、`edgeProjectionDirty`、`TransactionRunner.onIdle`、projection alignment check 显著收敛了这个竞态；后续新增 projection writer 仍必须遵守同一 publish gate。

3. 仍然需要关注三件事：
   - DestinationIntent 的产品语义合同：followBottom 是持续约束，jump 是一次性目标，restore 是历史状态恢复。
   - RuntimeDataSnapshotCoordinator 的路由顺序：它是 load-bearing 策略，不是普通 if/else。
   - current-feed runtime 边界：跨 feed 导航必须由外层 host 在进入 runtime 前完成判定，不能把 feed routing 混入 jump / restore command。
   - composition root 的依赖增长：service ref 循环依赖目前可控，但新增 projection writer 时必须明确写入权限和 flush 时机。

4. 不建议大重构。下一步最有价值的是补充行为合同和场景测试，尤其是“滚动中加载更多”“跳转中来新消息”“detach 后 edge error 再 attach”“大 DataWindow compaction”这些用户能感知的链路。

主要证据路径：

- `src/runtime/core/controller/runtimeControllerComposition.ts`
- `src/runtime/core/data/runtimeDataSnapshotCoordinator.ts`
- `src/runtime/events/edgeNeedCoordinator.ts`
- `src/runtime/core/projection/projectionCoordinator.ts`
- `src/runtime/core/projection/commitCoordinator.ts`
- `src/runtime/transactions/transactionRunner.ts`
- `src/runtime/core/commands/destinationIntentCoordinator.ts`
- `src/runtime/core/commands/viewportCompactionCoordinator.ts`
- `src/runtime/core/commands/viewportWindowBudget.ts`
- `src/runtime/transactions/bootstrapAnchorTransactions.ts`
