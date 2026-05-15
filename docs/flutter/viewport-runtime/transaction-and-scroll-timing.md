# Transaction 与滚动时序

## 1. Scope

本文定义 viewport runtime 如何把 data snapshot、projection commit、measurement 和
scroll correction 串成 deterministic transaction。

## 2. Core Pipeline

所有会改变 MaterializedWindow、extent，或需要 commit-time correction 的操作进入
transaction。

```text
cancel active motion if any
begin transaction
-> capture pre-state
-> compute projection
-> publish snapshot
-> wait layout committed ack
-> read required layout metrics
-> apply correction when required
-> schedule coalesced stabilization
-> commit runtime state
-> release transaction
```

Commit 后的第一轮测量使用同步 layout metrics。后续异步高度变化走 coalesced
stabilization。

如果 transaction settle 后需要目的地滚动动画，transaction 先释放
`TRANSACTING`，再把滚动写入权交给 motion engine。Motion settle 负责最终 anchor
capture 和 `viewportAnchorChanged(transactionSettle)`。

## 3. Read / Write Discipline

每个 correction phase 内：

```text
read all required metrics
-> compute corrections
-> write scroll offset / publish extent correction
```

不要交替 read/write。高度变化 callback 不立即写滚动位置，只记录 dirty keys 并调度
下一帧稳定化。

## 4. Commit Ack Wait

```text
PendingCommit {
  feedId
  generation
  revision
  transactionId
  timeout
}
```

规则：

- commit ack 必须匹配 `feedId + generation + revision`。
- stale ack 丢弃。
- timeout 后 transaction 进入 recovery，不继续测量旧 projection。
- destroy / detach 必须取消 pending commit。

推荐 timeout：

| Scenario | Timeout |
| --- | --- |
| bootstrap mount | 1000ms |
| normal projection | 500ms |
| jump projection | 800ms |

Timeout 不是成功路径，只用于避免 transaction 永久挂起。

## 5. Latest Bootstrap

```text
publish recent window with estimated beforeExtent
-> wait layout committed ack
-> measure materialized rows
-> move to latest bottom
-> wait at least one frame
-> if height dirty, stabilize to bottom
-> if stable frames reached or timeout reached, enter READY + LOCKED
```

该流程只适用于 latest snapshot，也就是数据层已确认 `hasMoreAfter == false`。

如果当前数据窗口仍有 after gap，latest bootstrap 不成立。

## 6. Prepend Transaction

```text
capture anchor key + anchor top
freeze scroll intent
publish prepended window + estimated extent
wait layout committed ack
measure anchor top
scrollOffset += newAnchorTop - oldAnchorTop
measure prepended rows
update height cache
publish extent correction if needed
commit anchor state
release scroll intent
```

如果 anchor row 已不可测量：

- 优先选择 commit 后第一条仍可测量的旧 visible row。
- 找不到则执行 reset bootstrap。

## 7. Append Transaction

Unlocked：

```text
publish appended window
wait layout committed ack
measure new rows
update afterExtent
do not scroll
```

Locked：

```text
publish appended window
wait layout committed ack
measure new rows
if motion enabled:
  start bounded bottom motion
else:
  instantly keep latest bottom visible
keep LOCKED
```

## 8. Dynamic Height Stabilization

Height change callback：

```text
markHeightDirty(key, newExtent)
scheduleStabilizationFrame()
```

Stabilization frame：

```text
collect dirty deltas
classify relative to current anchor
if bottom locked -> keep latest bottom visible
else if dirty above anchor -> scrollOffset += totalDelta
else no scroll correction
update height cache
publish extent correction if affected
```

如果 motion engine 正在运行，height stabilization 不得同时写滚动位置。
它必须把影响 target 的 delta 合并给 motion engine，或取消 motion 后再执行 normal
stabilization。任一帧内只能有一个滚动写入者。

## 9. Scroll Event Handling

Runtime 在 attach 时接收平台 scroll signal。

Scroll signal 不直接重算 window：

```text
onScroll -> markScrollDirty -> scheduleScrollFrame
```

Scroll frame：

```text
read scrollOffset / viewportExtent / contentExtent
classify source
update bottom lock hysteresis
capture viewport anchor if needed
decide whether to start window transaction
```

用户滚动时 anchor capture 应按 frame 节流，不要每个 raw signal 都读取 row metrics。

## 10. Scroll Source Classification

```text
ScrollSource =
  user
  momentum
  programmatic
  recovery
  followBottom
  jump
```

Runtime 写滚动位置前必须设置 token。Token 有效期间，scroll handler 不把该滚动解释为
用户主动滚动。

用户手势到达时必须取消 active motion，并让后续滚动重新按 user / momentum 分类。

## 11. Jump Transaction

```text
suspend current window
publish target window with estimated extent
wait layout committed ack
measure target row
resolve target alignment
handoff to motion if enabled, otherwise apply instant correction
motion settle or sync correction captures new anchor
enter READY
```

推荐 alignment：

| Command | Alignment |
| --- | --- |
| jump to message | center if enough context |
| restore AnchorState | top + offset |
| unread bootstrap | center around unread marker |
| follow bottom | bottom |

如果目标 row 不可测量：

- 检查 data snapshot 是否包含 target。
- 如果包含但 row 未 materialized，等待一次 commit retry。
- 如果仍不可测量，执行当前 projection 内 nearest measurable fallback。
- fallback 或失败恢复后必须退出 recovering state。

## 12. Resize Transaction

Viewport width 变化会改变 row height。

```text
capture current anchor
invalidate width-sensitive height cache
publish same or recomputed window
wait layout committed ack
measure anchor
correct scroll offset
schedule full stabilization
```

Viewport height 变化会改变 window threshold。它必须进入 resize transaction：
基于新 viewport extent 重算 window，publish 后等待 commit，再按 captured anchor
修正滚动位置。

## 13. Edge Signal Usage

Edge signal 用作辅助：

- before edge 接近 viewport -> prefetch before。
- after edge 接近 viewport -> prefetch after。
- 可选：帮助选择 anchor candidate。

Edge signal 不直接：

- 写滚动位置。
- 修改 MaterializedWindow。
- 判定 bottom lock truth。

`hasMoreAfter == true` 时，当前物理底部是 DataWindow after edge，不是 feed latest
bottom。普通下滑只能触发 `needMoreAfter`；显式 follow bottom 必须转为
`needLatestMessages`，由 data runtime 直接请求 latest window。

