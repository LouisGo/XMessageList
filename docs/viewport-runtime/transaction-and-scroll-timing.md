# Transaction 与滚动时序

## 1. Scope

本文档定义 runtime 如何把 data snapshot、React commit、DOM measurement 和 scroll correction 串成 deterministic transaction。

## 2. Core Pipeline

所有会改变 DOM window、spacer，或需要 commit-time scroll correction 的操作进入
transaction。Commit + measure 之后的 bounded scroll motion 不属于 transaction，
但任何新 transaction 启动前都必须先取消 active motion。

```text
cancel active motion if any
begin transaction
-> capture pre-state
-> compute projection
-> publish snapshot
-> wait React commit ack
-> synchronous DOM read
-> synchronous scroll correction when required
-> schedule rAF stabilization
-> commit runtime state
-> release transaction
```

React commit ack 之后，第一轮测量使用同步 DOM read。ResizeObserver 只处理后续异步高度变化。

如果 transaction settle 后需要目的地滚动动画，transaction 先释放
`TRANSACTING`，再把 scrollTop 写入权交给 `ScrollMotionEngine`。Motion settle
才负责最终 anchor capture 和 `viewportAnchorChanged(transaction-settle)` emit；
transaction commit callback 不为同一次目的地滚动提前 emit。

## 3. Read / Write Discipline

每个 correction phase 内：

```text
read all required DOM metrics
-> compute corrections
-> write scrollTop / spacer snapshot
```

不要交替 read/write：

```text
read rect
-> write scrollTop
-> read another rect
```

ResizeObserver 回调内不立即写 scrollTop。它只记录 dirty keys，并调度 rAF stabilization。

## 4. Commit Ack Wait

```ts
type PendingCommit = {
  feedId: string;
  generation: number;
  revision: number;
  transactionId: string;
  timeoutId: number;
};
```

规则：

- commit ack 必须匹配 `feedId + generation + revision`。
- stale ack 丢弃。
- timeout 后 transaction 进入 recovery，不继续同步测量旧 projection。
- `destroy` / `detach` 必须取消 pending commit。

推荐 timeout：

| Scenario          | Timeout |
| ----------------- | ------- |
| bootstrap mount   | 1000ms  |
| normal projection | 500ms   |
| jump projection   | 800ms   |

Timeout 不是成功路径，只用于避免 transaction 永久挂起。

## 5. Bootstrap Latest

```text
publish recent window with estimated topSpacer
-> wait commit
-> sync measure mounted rows
-> set scrollTop = scrollHeight
-> wait at least one rAF
-> if height dirty, stabilize to bottom
-> if stable frames >= 2 or timeout reached, enter READY + LOCKED
```

推荐 settle：

```ts
const BOOTSTRAP_STABLE_FRAMES = 2;
const BOOTSTRAP_HEIGHT_EPSILON_PX = 1;
const BOOTSTRAP_SETTLE_TIMEOUT_MS = 300;
```

关键高度变化：

```ts
Math.abs(currentScrollHeight - previousScrollHeight) >
  BOOTSTRAP_HEIGHT_EPSILON_PX;
```

超时后可以 READY，但后续 ResizeObserver 变化仍按 bottom locked stabilization 处理。

## 6. Prepend Transaction

```text
capture anchor key + anchor top
freeze scroll intent
publish prepended window + estimated spacer
wait commit
measure anchor top
scrollTop += newAnchorTop - oldAnchorTop
measure prepended rows
update height cache
publish spacer correction if needed
commit anchor state
release scroll intent
```

如果 anchor row 已被删除：

- 优先选择 commit 后第一条仍可测量的旧 visible row。
- 找不到则执行 reset bootstrap。

## 7. Append Transaction

Unlocked：

```text
publish appended window
wait commit
measure new rows
update bottom spacer
do not scroll
```

Locked：

```text
publish appended window
wait commit
measure new rows
if motion enabled and reduced motion is not requested:
  start bounded bottom motion
else:
  instant bottom write
keep LOCKED
```

`instant bottom write` 只用于 `prefers-reduced-motion` 生效或
`motionOptions.enabled=false` 的降级路径。距离很短和距离很远都仍走
`ScrollMotionEngine`：短距离直接 bounded animate，远距离先按 bounded motion
规则同步预落位，再动画最后可见段。

如果启动 bounded bottom motion，`viewportAnchorChanged(transaction-settle)` 由
motion settle callback 发出；如果走 instant bottom write，则可在同步写入和
anchor capture 完成后由 transaction settle 发出。

Append 不应该因为新消息到达而抢走用户向上阅读的位置。

## 8. Dynamic Height Stabilization

ResizeObserver callback：

```ts
function onResize(entries: ResizeObserverEntry[]) {
  for (const entry of entries) {
    markHeightDirty(resolveKey(entry.target), readEntryHeight(entry));
  }
  scheduleStabilizationRaf();
}
```

rAF stabilization：

```text
collect dirty height deltas
classify relative to current anchor
if bottom locked -> scrollToBottom
else if dirty above anchor -> scrollTop += totalDelta
else no scroll correction
update height cache
publish spacer correction if affected
```

底部锁定是 anchored stabilization 的例外状态。

如果 `ScrollMotionEngine` 正在运行，ResizeObserver stabilization 不得直接写
`scrollTop`。它必须把影响 motion target 的 delta 合并给 motion engine，或取消
motion 后再执行 normal stabilization。任一帧内只能有一个 scrollTop writer。

## 9. Scroll Event Handling

Runtime 在 `attach` 时注册 scroll listener。

Scroll listener 不直接重算 window：

```ts
function onScroll() {
  markScrollDirty();
  scheduleScrollRaf();
}
```

scroll rAF：

```text
read scrollTop/clientHeight/scrollHeight
classify source
update bottom lock hysteresis
capture viewport anchor if needed
decide whether to start window transaction
```

用户滚动时 anchor capture 推荐 rAF 节流，不要每个 raw scroll event 都 query row rect。

## 10. Scroll Source Classification

```ts
type ScrollSource =
  | 'user'
  | 'programmatic'
  | 'recovery'
  | 'followBottom'
  | 'jump'
  | 'momentum';
```

Runtime 写 scrollTop 前设置 token：

```ts
currentScrollWrite = {
  source: 'recovery',
  expiresAtFrame: frame + 2,
};
container.scrollTop += delta;
```

scroll handler 在 token 有效期间不把该 scroll 解释成用户主动滚动。

`source` 必须表达真实语义，不得为了复用 correction token 滥用
`recovery`：

- prepend / resize / commit-time anchor correction 使用 `recovery` 或
  `programmatic`，取决于是否处于 error recovery。
- follow-bottom motion 和 far-distance pre-positioning 使用 `followBottom`。
- quote / jump motion 和 far-distance pre-positioning 使用 `jump`。
- bottom locked append / send 使用 `programmatic`，并由已有 LOCKED 状态决定
  settle 后是否继续 LOCKED。

有效 token 只覆盖 runtime 自己的 scroll write。用户 wheel / touch / pointer /
keyboard intent 到达时必须取消 active motion，并让近期后续 scroll 重新按
user / momentum 分类；没有近期用户输入意图的 scroll 不能默认归为 user，
只能按 programmatic 处理。`attach` / `detach` / generation change 必须清掉
瞬时 scroll intent，避免缓存 runtime 复用时把上一次激活期的 source 继承到
下一次 feed 恢复。

## 11. Jump Transaction

```text
suspend current window
publish target window with estimated spacer
wait commit
measure target row
resolve target alignment
handoff to motion if enabled, otherwise apply instant correction
motion settle or sync correction captures new anchor
enter READY or RECOVERING->READY
```

推荐 alignment：

| Command             | Alignment                   |
| ------------------- | --------------------------- |
| jump to message     | center if enough context    |
| restore AnchorState | top + offset                |
| unread bootstrap    | center around unread marker |
| follow bottom       | bottom                      |

如果目标 row 不可测量：

- 检查 data snapshot 是否包含 target。
- 如果包含但 DOM 未注册，等待一次 commit retry。
- 如果仍不可测量，执行当前 projection 内的 nearest measurable fallback。
- fallback 或失败恢复后必须退出 `RECOVERING` projection，不得让 UI 停在中间态。

## 12. Resize Transaction

Container width 变化会改变 message height。

```text
capture current anchor
invalidate width-sensitive height cache
publish same window if needed
wait commit
measure anchor
correct scrollTop
schedule full stabilization
```

ResizeObserver 观察 container 时需要与 row ResizeObserver 区分。Container resize 可以触发 cache invalidation，row resize 只触发 local delta stabilization。

Container height 变化即使没有 width bucket 变化，也会改变 viewport-aware
window threshold。它必须进入 resize transaction：基于新 viewport height 重算
window，publish 后等待 commit，再按 captured anchor 修正 scrollTop。不能直接
忽略纯高度变化。

## 13. IntersectionObserver Usage

IO 用作辅助：

- top sentinel 接近 viewport -> 预取 before。
- bottom sentinel 接近 viewport -> 预取 after。
- 可选：帮助选择 viewport anchor 候选 row。

IO 不直接：

- 写 scrollTop。
- 修改 RenderWindow。
- 判定 bottom lock truth。

推荐 root：

```ts
new IntersectionObserver(callback, {
  root: container,
  rootMargin: `${edgeLoadThresholdPx}px 0px`,
  threshold: 0,
});
```

当前实现默认 `edgeLoadThresholdPx = 96`，也允许外部覆盖。`needMoreBefore` /
`needMoreAfter` 只会在 stable `READY` + `READY_IDLE` +
`bootstrapState=READY` 且 scroll source 为 user / momentum 时发出；user /
momentum 必须来自近期用户输入意图，不能由未知 scroll event、restore 对齐、
container attach 的 scrollTop 恢复或旧 `lastScrollSource` 推导出来。edge need
会在用户离开边缘前保持 latch，避免 bootstrap recovery / followBottom /
motion 写入 `scrollTop` 时误触发历史加载。

`hasMoreAfter=true` 时，当前物理底部是 DataWindow after edge，不是 feed latest bottom。
因此 bottom lock hysteresis 必须保持 `UNLOCKED`。普通下滑只能触发一批
`needMoreAfter(reason: 'near-bottom')`；显式 `followBottom` 必须转换为
`needLatestMessages(reason: 'bottom-follow')`，由接入方直接请求 latest window
并替换 DataWindow，不能沿 after edge 逐页补齐中间空洞。只有后续 snapshot
确认 `hasMoreAfter=false` 后，runtime 才能真正 `scrollToBottom()` 并进入
`LOCKED`。
