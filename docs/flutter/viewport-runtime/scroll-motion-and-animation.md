# Scroll Motion 与动画方案

## 1. Scope

本文定义 viewport runtime 如何处理目的地滚动动画。

目标不是让所有滚动写入都变成动画，而是在不破坏 deterministic viewport 的前提下，
为用户可感知的目的地滚动提供 motion。

不讨论：

- message row enter / exit 视觉动画。
- 业务 cell 内部动画。
- 图片、视频组件内部过渡。
- 数据层如何读取 latest / around window。

## 2. Core Decision

Runtime 必须自管 destination motion，不把核心滚动语义交给平台默认平滑滚动。

原因：

- 远距离 follow bottom / jump 经常跨 DataWindow 和 MaterializedWindow 重建，中间消息
  并不存在于当前 projection。
- 动画过程中可能发生新数据、height change、feed switch 或 generation reset。
- 需要明确区分 runtime write 和 user scroll，否则 bottom lock 与 edge paging 会被污染。

## 3. Motion Model

```text
MotionIntent =
  none
  instant(target)
  bounded(target, maxAnimatedDistance, duration)
  preserveAnchorDuringContentAnimation(anchor)
```

这些类型是 runtime 内部策略，不进入 public snapshot。

Public snapshot 仍只暴露 projection 必须渲染的字段。

## 4. Ownership

Motion active 期间只能有一个模块写滚动位置：motion engine。

Transaction 启动前必须同步取消 active motion。

取消后：

- old motion 不再写滚动位置。
- old motion 不 emit settled anchor。
- 新 transaction 接管后续 anchor emit。

## 5. Follow Bottom

`followBottom` 的目标是 feed latest bottom，不是当前 DataWindow 的物理底部。

流程：

```text
followBottom command
-> if hasMoreAfter == true: emit needLatestMessages, no motion
-> data runtime loads latest window
-> snapshot confirms hasMoreAfter == false
-> runtime computes latest MaterializedWindow
-> commit and measure
-> bounded bottom motion or instant bottom
-> emit viewportAnchorChanged(transactionSettle)
```

Pending 期间：

- 不触发 `needMoreAfter`。
- bottom lock 保持 `UNLOCKED`。
- 用户主动向上滚动会取消 pending follow bottom。
- generation change、detach、reset 会取消 pending follow bottom。

## 6. Bottom Locked Append / Send

当 bottom lock 为 `LOCKED` 且 `hasMoreAfter == false`：

```text
new item append
-> publish latest window
-> commit and measure
-> keep latest bottom visible
```

这属于 runtime 内部 locked append 行为，不是外部 public command。

如果用户处于 `UNLOCKED`，append 不应抢走阅读位置。

## 7. Jump / Quote

Jump / quote locate 是 destination intent。

```text
jump(target)
-> if target not in DataWindow: emit needMessagesAround(target), no motion
-> data runtime loads around target
-> runtime computes target window
-> commit and measure
-> bounded target motion or instant alignment
-> emit viewportAnchorChanged(transactionSettle)
```

远距离 jump 不尝试从旧位置连续滚到目标。目标缺失时只能围绕目标重建 DataWindow。

## 8. Restore

Restore 优先使用本地 `AnchorState`。如果只剩 identity 部分，data runtime 必须先用
`getMessagesAround` 读取目标附近数据。

本地 `AnchorState` 只在同一个 live runtime generation 内有效。runtime 被 destroy、
LRU 淘汰或 generation reset 后，restore 不能直接消费旧 `AnchorState`。

Restore 默认不做长距离动画。恢复历史会话位置的目标是稳定回到上次阅读上下文，
不是展示跨历史滚动路径。

## 9. Prepend / Window Slide

Prepend、trim、window slide 不启动 destination motion。

它们的目标是保持当前可见 anchor 不动：

```text
capture anchor
-> publish changed projection
-> commit and measure
-> apply anchor correction synchronously
```

任何动画都会让用户看到 anchor drift。

## 10. Dynamic Height During Motion

Motion active 期间发生 height change：

```text
classify relative to motion target / preserved anchor
-> update motion target if safe
-> or cancel motion and run normal stabilization
```

不得让 height stabilization 和 motion engine 在同一帧同时写滚动位置。

## 11. Cancellation

以下事件必须取消 active motion：

- user wheel / touch / drag / keyboard scroll intent。
- new viewport transaction。
- generation change。
- detach / destroy。
- reset command。
- reduced motion preference changed。

取消时 bottom lock 状态按实际语义决定，不强行 emit settled anchor。

## 12. Reduced Motion

Runtime options 应允许：

```text
motion.enabled
motion.maxAnimatedDistance
motion.durationMs
motion.respectReducedMotion
```

如果 reduced motion 生效，runtime 使用 instant target write，但仍必须走相同的
transaction、measurement、anchor settle 规则。

## 13. Testing Requirements

必须覆盖：

- partial DataWindow follow bottom emits `needLatestMessages` and starts no motion。
- latest window loaded 后 follow bottom 才开始 bottom motion。
- user upward scroll cancels pending follow bottom。
- far jump target missing emits `needMessagesAround` and starts no motion。
- around-target snapshot 到达后 pending jump 才执行 destination transaction。
- prepend never starts motion and keeps anchor visual top。
- height change during active motion does not create two scroll writers。
- motion settle emits one `viewportAnchorChanged(transactionSettle)`。
