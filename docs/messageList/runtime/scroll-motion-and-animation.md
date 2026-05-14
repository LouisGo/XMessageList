# Scroll Motion 与动画方案

## 1. Scope

本文定义 message viewport runtime 如何处理滚动动画。

目标不是让所有 `scrollTop` 写入变成动画，而是在不破坏 viewport
determinism 的前提下，为用户可感知的目的地滚动提供动画。

本文覆盖：

- `followBottom`
- 用户显式 `jump` / quote 定位
- bottom locked append / send 追底
- 删除、折叠、动态高度变化时的视觉稳定策略
- 动画取消、降级和测试要求

本文不覆盖：

- 数据层如何读取 around/latest page
- 业务高亮样式
- React projection 组件动画
- CSS transition / message row enter/exit 细节

## 2. Core Decision

不要使用浏览器原生 smooth scroll 作为 runtime 的核心滚动动画。

禁止把下面的代码作为默认实现：

```ts
container.scrollTo({
  top,
  behavior: 'smooth',
});
```

原因：

- 原生 smooth 的生命周期不可控，runtime 无法可靠知道何时结束、何时被用户打断。
- 远距离 `followBottom` / `jump` 经常跨 DataWindow 和 RenderWindow 重建，中间消息并不存在于 DOM，浏览器没有连续路径可以动画。
- 动画过程中触发的 scroll event 容易被误判为用户滚动，污染 bottom lock、edge pagination 和 viewport anchor capture。
- 当新数据、ResizeObserver、feed switch 或 generation reset 在动画过程中发生时，浏览器动画可能继续作用在过期 DOM 上。

Runtime 应采用：

```text
semantic decision
-> transaction / data-window stabilization
-> synchronous landing near target when needed
-> bounded JS animation for the final visible segment
-> settle / cancel / emit viewport anchor
```

## 3. External Learnings

### 3.1 React Virtuoso

Virtuoso 的主要价值是 scroll modifier，而不是具体动画执行。

可吸收点：

- 数据变化必须先带上滚动语义，例如 `prepend`、`append`，以及 Virtuoso 语境下
  的 `auto-scroll-to-bottom` modifier。
- 追底不是每次 append 都滚到底，而是依赖明确的 bottom-follow / at-bottom 状态。
- prepend 需要保留旧列表连续性，否则不能可靠恢复 scroll position。

转译到本 runtime：

- `MessageDataSnapshot.change.viewportEffect` 是 runtime 的 scroll modifier 等价物。
- React 不传滚动策略 prop，runtime 在 transaction 内解释 effect。
- 动画只在 effect / command 已经确定目标语义后发生。
- `auto-scroll-to-bottom` 只作为外部库术语参考；本 runtime 不新增同名 public
  command，LOCKED append 追底由 runtime 内部处理。

### 3.2 Telegram Web A

Telegram Web A 使用自管 `animateScroll`，不是浏览器原生 smooth。

可吸收点：

- 动画有最大距离上限。
- 远距离先把 `scrollTop` 同步移动到目标附近，再动画最后一段。
- duration 随距离变化，并有最小/最大边界。
- 当前动画可以 restart / cancel。
- 程序滚动和用户滚动必须区分。

转译到本 runtime：

- Runtime 需要内部 `ScrollMotionEngine`。
- 远距离 `followBottom` / `jump` 只动画最终可见段。
- 新 transaction、用户滚动、generation change、detach 都必须取消动画。

### 3.3 Telegram Web K

Telegram Web K 的价值在于 DOM 生命周期、ScrollSaver 和内容动画期间的 scroll
稳定。

可吸收点：

- 定位消息时通过 `scrollIntoViewNew` 计算目标位置，再由自管 JS 动画执行。
- 超过最大距离时先同步跳到目标附近，再动画剩余距离。
- 删除、折叠、消息高度动画期间，不依赖 scroll container smooth，而是保存 anchor 并在动画过程中恢复 scroll。
- peer/chat cleanup 会取消 container 维度的动画，避免旧会话污染新会话。

转译到本 runtime：

- 删除、折叠、ResizeObserver height correction 不走滚动动画。
- 如果内容本身有高度动画，runtime 需要 anchor-preservation loop，而不是 smooth scroll。
- feed teardown / generation reset 必须取消未完成 motion。

## 4. Motion Model

Runtime 内部增加一个滚动 motion 决策层。

```ts
type MotionDecision =
  | { type: 'none' }
  | { type: 'instant'; source: ScrollSource }
  | {
      type: 'bounded-animate';
      source: Extract<ScrollSource, 'programmatic' | 'followBottom' | 'jump'>;
      targetTop: number;
      maxDistancePx: number;
      minDurationMs: number;
      maxDurationMs: number;
      reason: 'follow-bottom' | 'jump' | 'bottom-append';
    }
  | {
      type: 'preserve-anchor-during-content-animation';
      anchor: AnchorState;
      reason: 'delete' | 'collapse' | 'height-change';
    };
```

这些类型是 runtime 内部策略，不进入 public snapshot。

Public snapshot 仍只暴露 React projection 必须渲染的字段。

### 4.1 Runtime Substate

Public `RuntimeState` 仍保持 `READY / TRANSACTING / ...`，但 `READY` 内部必须再
区分私有子状态：

```ts
type ReadySubstate =
  | 'READY_IDLE'
  | 'READY_FOLLOW_BOTTOM_PENDING'
  | 'READY_MOTION_ACTIVE';
```

这些子状态不进入 public snapshot，只用于规定 runtime 内部所有权：

- `READY_IDLE`：没有 pending command，也没有 active motion。
- `READY_FOLLOW_BOTTOM_PENDING`：显式 `followBottom` 正在等待 newer page 到达。
- `READY_MOTION_ACTIVE`：`ScrollMotionEngine` 拥有 `scrollTop` 写入权。

Motion 不是 transaction。Transaction 在 commit + measure 后释放
`TRANSACTING`，如果该操作需要动画，runtime 进入 `READY_MOTION_ACTIVE`，直到
motion settle 或 cancel。

### 4.2 Transaction Ownership

`TransactionRunner` 的优先级高于 motion：

```text
before starting any transaction:
  motionEngine.cancel('transaction-supersede')
  begin transaction
```

规则：

- 取消必须由 `TransactionRunner` 显式发起，不能依赖 motion 在 scroll event 中
  自行发现 `scrollTop` 被外部改写。
- `cancel()` 是同步失活操作：调用返回后，active motion token 已失效，已排队
  rAF callback 即使触发也必须先检查 token，不得再写一次 `scrollTop`。
- motion settle 负责最终的 anchor capture 和
  `viewportAnchorChanged(transaction-settle)` emit；transaction commit callback
  不能为同一次目的地滚动提前 emit。
- 如果新 transaction supersede 了 motion，由新 transaction 接管后续 anchor emit；
  被取消的旧 motion 不 emit settled anchor。

## 5. ScrollMotionEngine

推荐新增内部模块：

```ts
class ScrollMotionEngine {
  start(input: ScrollMotionStart): void;
  cancel(reason: ScrollMotionCancelReason): void;
  isActive(): boolean;
}
```

推荐输入：

```ts
type ScrollMotionStart = {
  container: HTMLElement;
  source: Extract<ScrollSource, 'programmatic' | 'followBottom' | 'jump'>;
  targetTop: number;
  maxDistancePx: number;
  minDurationMs: number;
  maxDurationMs: number;
  now: () => number;
  requestFrame: RuntimeScheduler['requestAnimationFrame'];
  cancelFrame: RuntimeScheduler['cancelAnimationFrame'];
  onFrameWrite: (nextTop: number, source: ScrollSource) => void;
  onSettle: () => void;
  onCancel: () => void;
};
```

执行规则：

1. 读取当前 `scrollTop` 和 `targetTop`。
2. 如果距离 `<= 1px`，直接 settle。
3. 如果距离大于 `maxDistancePx`：
   - 向目标方向同步写到 `targetTop ± maxDistancePx`。
   - 这一步仍标记为 runtime scroll write，并沿用本次 motion source。
   - `followBottom` 预落位使用 `source: 'followBottom'`。
   - `jump` 预落位使用 `source: 'jump'`。
   - 不得使用 `source: 'recovery'`，否则会污染 recovery 和 bottom-lock 语义。
4. 用 rAF 动画剩余距离。
5. 每帧只写 `scrollTop`，不读 row rect，不 publish projection。
6. 到达目标、超时、用户打断、transaction supersede、generation change、detach 时结束。

`ScrollMotionEngine` 必须维护单调递增的 motion token：

```ts
type ActiveMotion = {
  id: number;
  source: Extract<ScrollSource, 'programmatic' | 'followBottom' | 'jump'>;
  frameId: number | null;
};
```

每个 rAF callback 写入前都必须验证 `id` 仍是当前 active motion。`cancel()` 同步
清空 active motion 并取消已知 frame；无法被浏览器取消的已排队 callback 也会因
token 失配而成为 no-op。

推荐默认参数：

| Option | Default |
| --- | --- |
| maxDistancePx | 800 |
| minDurationMs | 180 |
| maxDurationMs | 420 |
| targetEpsilonPx | 1 |

动效曲线推荐：

```ts
function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5;
}
```

短距离可以用更轻的 ease-out；第一版可以只实现一条曲线，避免过早调参。

## 6. Operation Semantics

### 6.1 Follow Bottom

`followBottom` 的目标是 feed latest bottom，不是当前 DataWindow 的物理 bottom。

流程：

```text
command followBottom
-> if hasMoreAfter=true: emit needMoreAfter(bottom-follow), no motion
-> data layer appends newer pages until hasMoreAfter=false
-> runtime computes latest RenderWindow
-> publish projection
-> wait commit ack
-> measure mounted rows
-> compute real bottom target
-> bounded-animate to bottom
-> set LOCKED
-> emit viewportAnchorChanged(transaction-settle)
```

注意：

- 如果 target window 重建导致距离很远，先同步落到 bottom 附近，再动画最后一段。
- 动画期间 scroll source 是 `followBottom`。
- 动画期间不得触发 `needMoreBefore` / `needMoreAfter`。
- 动画期间不得启动 window slide transaction。

#### 6.1.1 Pending Follow Bottom

当 `followBottom` 到达但当前 snapshot 仍是 `hasMoreAfter=true`：

```ts
type PendingFollowBottom = {
  feedId: string;
  generation: number;
  commandId: string;
  emittedAfterRevision: number | null;
};
```

Runtime 保留该 command，并进入内部 `READY_FOLLOW_BOTTOM_PENDING`。这不是
`TRANSACTING`，因为此时没有 projection 正在等待 commit；但它也不是普通
`READY_IDLE`，因为后续 `setDataSnapshot` 必须继续驱动同一个 follow-bottom
意图。

驱动规则：

- 首次进入 pending 时 emit `needMoreAfter(bottom-follow)`。
- 每次 `setDataSnapshot` 到达后，如果 `feedId + generation` 仍匹配且
  `hasMoreAfter=true`，runtime 继续保持 pending，并在接入层完成上一批请求后
  允许再次 emit `needMoreAfter(bottom-follow)`；同一个 data revision 最多 emit
  一次，避免请求风暴。
- 当 `hasMoreAfter=false`，runtime 消费 pending command，启动 latest-window
  transaction；commit + measure 后进入 bounded motion。
- 用户主动向上滚动、显式 `jump` / `restore` / `reset`、generation change、
  detach / destroy 都取消 pending command。
- Pending 期间普通 near-bottom edge latch 被抑制；runtime 只允许
  `needMoreAfter(bottom-follow)`，避免同时出现 `near-bottom` 和 `bottom-follow`
  两种语义。
- Pending 期间 bottom lock 保持 `UNLOCKED`。只有真正落到 feed latest bottom 并
  motion settle 后才能进入 `LOCKED`。

### 6.2 Bottom Locked Append / Send

当 bottom lock 为 `LOCKED` 且 `hasMoreAfter=false`：

```text
append / send while locked
-> publish latest window
-> wait commit
-> measure
-> bounded-animate to bottom
-> keep LOCKED
```

如果距离很短，可以正常动画。

如果距离过大，按 bounded motion 规则先同步靠近，再动画最后一段。

这里的追底是 runtime 内部 locked-append 行为，不是外部 public command。

### 6.3 Jump / Quote

`jump` / quote 定位可能跨很远的消息区间。

流程：

```text
command jump(target identity)
-> if target not in DataWindow: data layer loads around target
-> runtime computes window around target
-> publish projection
-> wait commit
-> resolve measurable target row
-> compute targetTop for center/top alignment
-> bounded-animate final visible segment
-> set UNLOCKED
-> emit viewportAnchorChanged(transaction-settle)
```

规则：

- 不尝试从旧 scrollTop 连续动画到远处目标。
- target row 未挂载时不启动动画。
- target DOM fallback 仍按现有 nearest measurable row 逻辑。
- 如果 command 被新的 jump / followBottom supersede，取消当前 motion。
- 动画期间 scroll source 是 `jump`。
- `viewportAnchorChanged(transaction-settle)` 由 motion settle 触发。App 层可用
  该 anchor 和原始 command identity 决定是否展示 quote / jump 高亮；runtime
  不直接管理业务高亮样式。

### 6.4 Restore

`restore` 不动画。

原因：

- restore 是生命周期恢复，不是用户即时视觉命令。
- 用户期望打开会话后直接回到保存位置。
- 动画会延迟可交互状态，并且容易暴露中间错误位置。

### 6.5 Prepend / Window Slide

prepend 和 window slide 不动画。

它们的目标是保持当前可见 anchor 不动：

```text
capture anchor before
publish projection
wait commit
measure anchor after
scrollTop += delta
```

这里必须同步修正。任何动画都会让用户看到 anchor drift。

### 6.6 Delete / Collapse / Dynamic Height

删除、折叠和动态高度变化分两类：

1. bottom locked 且目标是 feed bottom：
   - 可在 commit + measure 后用 bounded animate 回到底部。
2. 用户在中间阅读：
   - 不滚动到新位置。
   - 保存当前 viewport anchor。
   - 内容高度动画期间每帧恢复 anchor。

推荐内部策略：

```text
save anchor rect
start content animation
while animation active:
  read anchor rect
  write scrollTop += rectAfter - rectBefore
settle anchor
```

第一版可以不实现内容动画期间的循环恢复，只保留现有即时 height correction；
但不要把这类场景接到 bounded scroll motion。

### 6.7 ResizeObserver During Motion

Motion active 期间只能有一个模块写 `scrollTop`：`ScrollMotionEngine`。

当 ResizeObserver 在 `READY_MOTION_ACTIVE` 期间报告高度变化：

```text
collect dirty height deltas
classify relative to motion target / preserved anchor
if delta affects target geometry:
  motionEngine.adjustTarget(delta)
else:
  update height cache / record pending spacer metadata
do not write scrollTop from stabilization rAF
```

第一版采用 target-adjust 策略，而不是 motion settle 后再一次性补偿：

- bottom motion 中，底部内容高度变化会把 `targetTop` 调整到新的 bottom。
- jump motion 中，目标 row 上方高度变化会把 `targetTop` 加上对应 delta。
- 当前视口中目标 row 自身高度变化时，按 alignment 重新计算 target。
- 与 motion target 无关的 dirty row 只更新 height cache。若 spacer correction
  需要 publish projection，则必须等 motion settle 后执行，或先取消 motion 再由
  transaction 接管。

如果实现阶段暂时无法安全合并 delta，保守降级路径是同步
`motionEngine.cancel('resize-during-motion')`，然后进入 normal stabilization；
但不得让 ResizeObserver stabilization rAF 和 motion rAF 在同一帧同时写
`scrollTop`。

## 7. Cancellation And Source Classification

Motion 必须被以下事件取消：

- user wheel / touch / pointer / keyboard scroll intent
- new viewport transaction starts
- command superseded by later jump / followBottom / reset
- generation change
- detach / destroy
- target container missing
- commit timeout recovery

Motion active 期间：

- `ScrollIntentEngine.classifyScroll()` 返回 motion source。
- edge load emission 必须忽略 motion source。
- bottom lock hysteresis 不能把 motion scroll 当成 user scroll。
- viewport anchor idle event 不应由 motion scroll 触发；settle 后发
  `transaction-settle`。

不同 source 的 settle 规则：

| Source | Settle bottom lock | Anchor event |
| --- | --- | --- |
| `followBottom` | set `LOCKED` | emit `viewportAnchorChanged(transaction-settle)` after final bottom |
| `jump` | set / keep `UNLOCKED` | emit `viewportAnchorChanged(transaction-settle)` after target alignment |
| `programmatic` bottom append | keep `LOCKED` if it started locked | emit `viewportAnchorChanged(transaction-settle)` after final bottom |

Motion cancel 后：

- 不强行 emit settled anchor。
- 不保持 RECOVERING 状态。
- 当前 transaction 根据取消原因决定恢复到 READY 或被新 transaction 接管。

## 8. Reduced Motion And Configuration

默认尊重 reduced motion：

```ts
window.matchMedia('(prefers-reduced-motion: reduce)').matches
```

当 reduced motion 开启：

- `bounded-animate` 降级为 `instant`。
- preserve-anchor correction 仍执行。

Runtime 至少必须在每次 motion decision 时重新读取一次
`prefers-reduced-motion`。可选增强是在 `attach` 后订阅 media query change；
如果 active motion 期间用户切到 reduced motion，runtime 应取消当前 motion，并
用相同 source 即时落到当前最新 target，再按正常 settle 规则发 anchor event。

推荐 runtime options：

```ts
type ScrollMotionOptions = {
  enabled?: boolean;
  respectReducedMotion?: boolean;
  maxDistancePx?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
};
```

默认：

```ts
{
  enabled: true,
  respectReducedMotion: true,
  maxDistancePx: 800,
  minDurationMs: 180,
  maxDurationMs: 420,
}
```

这些配置只影响内部 motion，不进入 snapshot。

## 9. Testing Requirements

Runtime unit tests:

- `followBottom` on partial DataWindow emits `needMoreAfter` and starts no motion.
- pending `followBottom` survives newer-page snapshots until `hasMoreAfter=false`.
- user upward scroll cancels pending `followBottom` and suppresses further bottom-follow requests.
- after newer pages loaded to latest, follow bottom rebuilds latest window before motion.
- far follow bottom writes an immediate near-target scrollTop, then animates bounded final segment.
- far pre-positioning uses `followBottom` / `jump` source tokens, never `recovery`.
- jump to far target waits for target window commit and measurable row before motion.
- jump motion cancel on user wheel leaves runtime READY and bottom lock UNLOCKED.
- append while LOCKED uses bounded motion only after commit + measure.
- prepend never starts motion and keeps anchor visual top.
- restore never starts motion.
- dynamic height stabilization while not bottom locked never starts motion.
- ResizeObserver during active motion adjusts motion target or cancels motion; it never writes
  `scrollTop` concurrently with motion rAF.
- motion settle emits one `viewportAnchorChanged(transaction-settle)`; transaction commit does not emit a duplicate.
- detach / destroy cancels active motion.

Integration scenarios:

1. 10000 条消息，恢复到中间位置，点击 Bottom。
2. 10000 条消息，点击远距离 quote。
3. bottom locked 下连续 send / append。
4. 中间阅读时删除当前视口上方/内部消息。
5. 用户滚动打断正在进行的 bottom motion。
6. reduced motion 开启后所有目的地 motion 即时落位。

## 10. Implementation Order

推荐顺序：

1. 添加 `ScrollMotionEngine` 和 fake scheduler 测试。
2. 接入 transaction-start 前同步 `motionEngine.cancel('transaction-supersede')`。
3. 接入 scroll write token source：`followBottom` / `jump` / `programmatic`。
4. 接入 `followBottom` pending 状态和 bottom-follow `needMoreAfter` 循环。
5. 接入 `followBottom`，覆盖 `hasMoreAfter=false` 的 latest target。
6. 接入 bottom locked append / send。
7. 接入 `jump`，并确保 target row commit + measure 后才启动。
8. 加用户输入取消和 reduced-motion 降级。
9. 接入 ResizeObserver during motion 的 target-adjust 或 cancel 降级。
10. 扩展测试到 far distance、pending followBottom、settle event 和 reduced motion。
11. 再评估是否实现 delete/collapse 的 preserve-anchor animation loop。

不要在第一版实现：

- 浏览器原生 smooth。
- 跨多个 DataWindow 的连续滚动动画。
- React projection 里直接读写 scrollTop。
- row enter/exit animation 与 scroll motion 的耦合。
