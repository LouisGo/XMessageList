# Message Viewport Runtime 补充规范

补充三个“必须明确”的 Runtime Spec。这三部分实际上会决定：

- runtime 是否 deterministic
- React integration 是否可维护
- bottom lock 是否稳定

这已经属于真正的 IM runtime 内核层了。

---

# Appendix A — Initial Session Bootstrap Spec

这是：

```text id="jlwm61"
首次进入会话
```

的专用初始化协议。

它不是普通：

```text id="jlwm63"
jumpToMessage
```

因为：

首次进入时：

- 没有已有 viewport
- 没有 anchorState
- 没有 measurement cache
- 没有稳定 spacer

因此：

# Bootstrap 是独立状态。

---

# A.1 Bootstrap Targets

Bootstrap 允许三种入口：

| Mode     | Description      |
| -------- | ---------------- |
| Latest   | 进入最新消息     |
| Unread   | 进入未读位置     |
| Restored | 恢复历史会话位置 |

---

# A.2 Bootstrap State

```ts id="jlwm67"
type BootstrapState =
  | 'INITIAL'
  | 'MOUNTING'
  | 'MEASURING'
  | 'STABILIZING'
  | 'READY';
```

Bootstrap 完成前：

禁止：

- trim
- auto follow
- prepend
- scroll correction

否则：

初始 viewport 会漂移。

---

# A.3 Latest Bootstrap

最新消息模式：

目标：

```text id="jlwm71"
bottom locked initial viewport
```

流程：

```text id="jlwm73"
① Mount recent message window

② Estimate top spacer

③ Initial browser layout

④ Force scroll to bottom

⑤ Wait minimum one rAF

⑥ Wait layout settle

⑦ Capture bottom anchor

⑧ Enter LOCKED state
```

该流程只适用于 latest bootstrap，也就是响应已经确认 `hasMoreAfter=false`。
如果 restore / jump 落在一个 partial DataWindow 内，即使物理滚到当前 DOM 底部，
也只能保持 `UNLOCKED` 并通过 `needMoreAfter` 补齐 newer page。

注意：

```text id="jlwm75"
capture anchor
```

必须发生在：

```text id="jlwm77"
bottom scroll settled and layout settled
```

之后。

否则：

图片解码会导致：

```text id="jlwm79"
fake bottom lock
```

`one rAF` 只是最小等待。

READY 前必须满足：

```text
连续 N 个 frame 没有关键高度变化
```

或达到：

```text
bootstrap settle timeout
```

timeout 后可以进入 READY，但后续高度变化仍必须走 stabilization。

---

# A.4 Unread Bootstrap

Unread 模式：

目标：

```text id="jlwm81"
unread marker positioned near viewport center
```

而不是：

```text id="jlwm83"
strict top align
```

因为：

IM 用户的视觉上下文需要：

- unread 前消息
- unread 后消息

同时存在。

---

# A.5 Restored Bootstrap

恢复历史位置：

```ts id="jlwm85"
restore(anchorState);
```

如果：

```text id="jlwm87"
anchor message unavailable
```

允许：

```text id="jlwm89"
nearest-neighbor fallback
```

例如：

```text id="jlwm91"
closest known messageId
```

不要强依赖：

```text id="jlwm93"
exact message existence
```

否则：

message retention policy 会导致 restore 失败。

---

# Appendix B — Dynamic Height Stabilization Refinement

这是对：

```text id="jlwm95"
9.2 Stabilization Rule
```

的修正。

你指出的问题是正确的：

# Bottom Lock 是例外状态。

---

# B.1 Stabilization Modes

系统必须区分：

| Mode         | Behavior         |
| ------------ | ---------------- |
| Anchored     | 维持 anchor 位置 |
| BottomLocked | 维持底部连续性   |

这是两个不同系统。

---

# B.2 Anchored Mode

普通模式：

如果：

```text id="jlwm99"
mutation above anchor
```

执行：

```ts id="jlwm101"
scrollTop += deltaHeight;
```

如果：

```text id="jlwm103"
mutation below anchor
```

不修正。

这是普通 anchor stabilization。

---

# B.3 BottomLocked Mode

LOCKED 状态：

底部：

```text id="jlwm105"
本身就是 anchor
```

因此：

任何：

- 新消息 append
- 图片高度增长
- reaction expand

都必须：

# 跟随底部。

规则：

```ts id="jlwm107"
if (isBottomLocked) {
  scrollToBottom();
}
```

但：

必须：

```text id="jlwm109"
coalesced in rAF
```

不能：

```text id="jlwm111"
每次 ResizeObserver 立即滚动
```

否则：

会形成：

```text id="jlwm113"
bottom oscillation
```

---

# B.4 Bottom Lock Threshold

LOCKED 判断：

禁止：

```ts id="jlwm115"
scrollTop + clientHeight === scrollHeight;
```

推荐使用双阈值：

```ts id="jlwm117"
const LOCK_THRESHOLD_PX = 40;
const UNLOCK_THRESHOLD_PX = 120;
```

推荐：

```text id="jlwm119"
24px ~ 80px hysteresis window
```

规则：

```text
distanceToBottom <= LOCK_THRESHOLD_PX
-> LOCKED
```

```text
distanceToBottom > UNLOCK_THRESHOLD_PX
-> UNLOCKED
```

中间区域：

```text
保持原状态
```

原因：

Chromium：

- subpixel layout
- momentum scrolling
- async image decode

会导致：

```text id="jlwm121"
exact equality 永远不稳定
```

---

# Appendix C — React Runtime Boundary Spec

这是目前最容易架构失控的部分。

关键原则：

# Runtime owns viewport

# React owns projection

---

# C.1 Runtime Responsibilities

Runtime：

```ts id="jlwm125"
class MessageRuntime
```

负责：

| Responsibility     | Owner   |
| ------------------ | ------- |
| scrollTop writes   | Runtime |
| anchor capture     | Runtime |
| measurement        | Runtime |
| trim/prepend       | Runtime |
| spacer update      | Runtime |
| window calculation | Runtime |

Runtime 必须：

# imperative

---

# C.2 React Responsibilities

React：

只负责：

```text id="jlwm127"
RenderWindow projection
```

例如：

```tsx id="jlwm129"
<MessageList messages={windowedMessages} />
```

React：

不负责：

- scroll stabilization
- anchor correction
- viewport timing

否则：

Concurrent Rendering 会破坏 deterministic timing。

---

# C.3 Runtime → React Synchronization

推荐模型：

```ts id="jlwm131"
runtime.subscribe((windowState) => {
  store.setState(windowState);
});
```

React：

通过：

- useSyncExternalStore
- Zustand
- observable store

订阅 runtime。

其中：

```text
useSyncExternalStore 语义是 primary contract
```

Zustand / observable 只能作为该合同的封装。

而不是：

```text id="jlwm133"
runtime -> React setState chains
```

---

# C.4 Why React Cannot Own Window State

错误模型：

```tsx id="jlwm135"
const [window, setWindow] = useState();
```

然后：

```text id="jlwm137"
scroll event
-> setWindow
-> rerender
-> layout
-> measure
-> correction
```

这是不稳定的。

因为：

React：

- batching
- concurrent scheduling
- transition interruption

会破坏：

```text id="jlwm139"
viewport timing determinism
```

---

# C.5 Correct Projection Pipeline

正确模型：

```text id="jlwm141"
scroll event
-> runtime computes window
-> runtime mutates viewport state
-> runtime publishes projection
-> React renders projection
-> browser layout
-> runtime measures
-> runtime stabilizes anchor
```

注意：

# Runtime 永远在 React 之前。

React：

只是：

```text id="jlwm143"
viewport 的视觉投影层
```

不是：

```text id="jlwm145"
viewport runtime 本身
```

---

# Appendix D — Recommended Future Extensions

当前架构稳定后，可以继续扩展：

---

## D.1 Sticky Group Runtime

例如：

- 日期分组
- unread divider
- pinned message

本质：

```text id="jlwm147"
secondary anchor systems
```

---

## D.2 Predictive Measurement

对：

- 图片
- markdown
- known templates

进行：

```text id="jlwm149"
pre-layout estimation
```

减少：

```text id="jlwm151"
late stabilization
```

---

## D.3 Incremental Media Hydration

例如：

```text id="jlwm153"
先 mount text shell
后 hydrate image/video
```

减少：

```text id="jlwm155"
layout burst
```

---

# Final Clarification

到这一阶段，

这个系统已经不应该再被视为：

```text id="jlwm157"
Virtual List Library
```

而应该视为：

# Deterministic Message Viewport Runtime

它本质上更接近：

- incremental layout runtime
- viewport state machine
- anchor stabilization engine

而不是：

```text id="jlwm159"
普通 virtualization abstraction
```
