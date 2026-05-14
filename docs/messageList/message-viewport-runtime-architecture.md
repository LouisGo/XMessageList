# Message Viewport Runtime 架构白皮书（Implementation-Oriented Draft）

## 1. Scope

本文档定义一个面向 IM / Chat 场景的 Message Runtime 架构。

目标环境：

- Electron
- 最新 Chromium
- React 18+
- 动态高度消息
- 双向无限历史加载
- prepend-heavy message flow

本文档不讨论：

- 通用虚拟列表
- SSR
- React Native
- Legacy Browser
- 极限 DOM 压缩

核心目标：

1. Viewport Stability
2. Deterministic Scroll Behavior
3. Dynamic Height Stability
4. Prepend Continuity
5. Async Media Stability

而不是：

- 最少 DOM
- 理论最大消息数
- 数学型 virtualization

---

# 2. System Model

系统本质上不是：

```text id="z6d1dm"
VirtualList
```

而是：

```text id="mpsxxk"
Viewport Runtime
```

Runtime 维护的是：

```text id="7ujx2s"
用户当前正在观察的消息视口
```

而不是：

```text id="j5ykte"
整个消息集合的几何布局
```

---

# 3. Core Principles

---

## 3.1 Flow-first Layout

消息必须保留在正常文档流中：

```css id="hnl9w1"
display: block;
position: static;
```

禁止作为主布局方案使用：

```css id="v53fls"
position: absolute;
transform: translateY(...);
```

原因不是性能，而是：

- Scroll Anchoring
- Incremental Layout
- Native Reflow Compensation
- Async Layout Stabilization

这些能力全部依赖文档流。

Message Runtime 的职责是：

```text id="zy1a1h"
管理 DOM Window
```

而不是：

```text id="b5l1g7"
重建 Layout Engine
```

---

## 3.2 Anchor-first Scroll Model

scrollTop 不是权威状态。

权威状态：

```ts id="s7s0eo"
type AnchorState = {
  messageId: string;
  offsetWithinMessage: number;
};
```

含义：

```text id="2ycs5k"
当前视口顶部位于哪个消息的哪个局部偏移
```

AnchorState 是：

- prepend recovery
- resize stabilization
- history restore
- jump navigation

的唯一稳定坐标系。

---

## 3.3 Runtime-owned Scroll Semantics

禁止业务层直接操作：

```ts id="j8ez5z"
scrollTop;
```

Runtime 对外只暴露语义操作：

```ts id="1vc3gc"
scrollToMessage(id);
jumpToUnread();
followBottom();
restoreAnchor(anchor);
```

原因：

scrollTop 只是：

```text id="7bxxkq"
当前 viewport 的物理结果
```

而不是：

```text id="rzpqdx"
业务语义
```

---

# 4. DOM Window Architecture

---

## 4.1 Window Definition

DOM Window：

```ts id="szhjfj"
type RenderWindow = {
  itemKeys: MessageRuntimeItemKey[];
  startIndex: number;
  endIndex: number;
};
```

其中：

```text
itemKeys 是窗口身份
```

```text
startIndex / endIndex 只是当前 DataSnapshot 内的临时派生值
```

index 禁止作为：

- restore 坐标
- cross-process contract
- persistent anchor
- cache identity

只渲染：

```text id="p4nk7t"
可见区域附近消息
```

推荐规模：

| 类型             | 推荐值   |
| ---------------- | -------- |
| visible messages | 20~80    |
| overscan         | 100~300  |
| total mounted    | 原型默认 40~200；仅在 profiling 后再提高 |

这些 count 指的是 mounted projection rows，不保证等于业务消息条数。如果后续引入 sender / date grouping，仍然应该以 runtime 的 row unit 为窗口、trim 和 anchor 的稳定单位。

Electron + Chromium 下无需极限优化，但也不要把“调大 mounted 上限”误当成默认正确答案。

---

## 4.2 Spacer Strategy

使用：

```html id="wn4trq"
topSpacer bottomSpacer
```

维持滚动连续性。

但 Spacer 的职责仅为：

```text id="4pwvuk"
近似占位
```

不是：

```text id="6c7fe6"
全局精确坐标系统
```

因此：

允许：

- lazy correction
- estimated height
- partial inaccuracy

禁止：

```text id="g9pv18"
全局 cumulative exact offsets
```

---

# 5. Measurement Architecture

---

## 5.1 Measurement Scope

测量必须局部化。

仅允许：

```text id="yqz9ef"
window 附近消息参与测量
```

禁止：

```text id="mdqu1m"
全量 ResizeObserver
```

---

## 5.2 Measurement Ownership

Measurement 是：

```text id="xazlmh"
观察行为
```

不是：

```text id="m7c8om"
布局驱动行为
```

即：

错误模型：

```text id="6vfj9h"
measure -> recompute layout -> rerender
```

正确模型：

```text id="i4d7ai"
browser layout
  -> observe delta
  -> stabilize anchor
```

系统永远不主动“计算布局”。

布局权属于浏览器。

---

## 5.3 Height Cache

允许维护：

```ts id="j1ws8w"
Map<MessageRuntimeItemKey, MeasuredHeight>;
```

但：

缓存仅用于：

- spacer estimation
- trim continuity
- jump initialization

不用于：

```text id="j5pxe2"
全局 offset 推导
```

缓存必须失效于：

- feed reset
- container width 变化
- font / density / theme 影响布局
- message content version 变化
- identity rebind 后无法确认内容等价

trim 后允许保留最近高度。

但必须有容量上限。

Height Cache 不是：

```text
永久布局数据库
```

---

# 6. Scroll Intent Engine

这是 Runtime 的核心状态机之一。

---

## 6.1 Scroll Source Classification

必须区分：

| 类型               | 来源              |
| ------------------ | ----------------- |
| UserScroll         | 用户主动滚动      |
| ProgrammaticScroll | Runtime 调用      |
| MomentumScroll     | Chromium 惯性滚动 |
| RecoveryScroll     | Anchor 修复       |
| FollowBottomScroll | 自动追底          |

否则：

Bottom Lock 无法稳定。

---

## 6.2 Intent Ownership

Programmatic scroll 必须进入：

```ts id="jlwmh3"
scrollTransaction;
```

例如：

```ts id="e8t1t0"
runtime.beginScrollTransaction();
runtime.scrollToMessage(id);
runtime.endScrollTransaction();
```

scroll event handler 必须识别：

```text id="gop3wb"
当前 scroll 是否来自 runtime
```

否则：

会错误解除：

```text id="oj9jlwm"
bottom lock
```

---

## 6.3 Bottom Lock State Machine

Bottom Lock 必须独立。

```ts id="zlzj64"
type BottomLockState = 'LOCKED' | 'UNLOCKED' | 'RECOVERING';
```

状态转换：

| 行为                | 结果        |
| ------------------- | ----------- |
| 用户向上滚动        | UNLOCKED    |
| 用户回到底部        | LOCKED      |
| 新消息到达且 LOCKED | auto follow |
| Programmatic jump   | RECOVERING  |

Bottom Lock 不能依赖：

```text id="nm0l7u"
scrollTop === max
```

必须允许：

```text id="8a7qgx"
epsilon threshold
```

否则：

Chromium subpixel rounding 会导致抖动。

---

# 7. Prepend Pipeline

这是系统最关键流程。

必须原子化。

---

## 7.1 Prepend Execution Sequence

正确时序：

```text id="rz4cb2"
① Capture AnchorState

② Freeze Scroll Intent

③ Insert Messages Into DOM

④ Browser Reflow

⑤ Measure Prepended Height Delta

⑥ Adjust scrollTop By Delta

⑦ Update Spacer

⑧ Commit New AnchorState

⑨ Release Scroll Intent
```

---

## 7.2 Timing Constraints

步骤：

```text id="gc7s6s"
③~⑦
```

必须属于：

```text id="vfiycj"
同一个 viewport transaction
```

在 React projection 路径下，③ 不是 runtime 直接插 DOM。

而是：

```text
publish projection
-> wait projection commit
-> same correction phase
```

commit 之后的：

- Browser Reflow
- Measure Delta
- scrollTop Correction
- Spacer Update

必须在同一个 correction phase 中完成。

否则：

用户会观察到：

- jump
- flash
- scroll drift

---

## 7.3 Why Native overflow-anchor Is Disabled

推荐：

```css id="fyy4cu"
overflow-anchor: none;
```

原因不是浏览器能力不足。

而是：

浏览器 anchoring 属于：

```text id="5wl8m0"
best-effort heuristic
```

在以下场景不稳定：

- prepend + trim
- async media resize
- spacer mutation
- partial DOM detach

Message Runtime 需要：

```text id="ji5rqj"
deterministic anchor timing
```

因此：

必须接管 anchoring。

---

# 8. Window Trim Pipeline

---

## 8.1 Trim Principle

trim 的本质：

```text id="yk5m3r"
DOM memory reclamation
```

不是：

```text id="pph5kl"
布局行为
```

---

## 8.2 Atomic Trim

错误时序：

```text id="1s8yul"
remove DOM
-> next frame
-> increase spacer
```

会导致：

```text id="c8xww1"
scrollHeight 瞬间收缩
```

正确方式：

```text id="d6yq9m"
remove DOM
+
increase spacer
```

必须：

```text id="0rf5cq"
同一帧提交
```

---

## 8.3 Trim Safety Margin

禁止：

```text id="5dgcn9"
刚离开 viewport 就 trim
```

推荐：

```text id="4gtu7l"
retain buffer window
```

因为：

- selection
- image decode
- momentum scroll

都需要稳定缓冲区。

---

# 9. Dynamic Height Stabilization

---

## 9.1 Height Mutation Sources

| Source          | Async |
| --------------- | ----- |
| image decode    | yes   |
| GIF             | yes   |
| markdown render | yes   |
| code highlight  | yes   |
| translation     | yes   |
| reaction expand | yes   |

---

## 9.2 Stabilization Rule

规则：

```text id="jlwmki"
仅处理 anchor 之前的高度变化
```

如果：

```text id="2a2jqt"
mutation below anchor
```

不进行 scroll correction。

如果：

```text id="x0m1fr"
mutation above anchor
```

执行：

```ts id="9rwqfx"
scrollTop += deltaHeight;
```

---

## 9.3 Mutation Coalescing

禁止：

```text id="9qzexq"
每次 ResizeObserver 都修正 scrollTop
```

必须：

```text id="8p1i1l"
rAF coalescing
```

否则：

会形成：

```text id="wrf43o"
micro jitter
```

---

# 10. History Jump Pipeline

历史跳转属于独立状态机。

例如：

- jumpToMessage
- reply jump
- search locate
- unread restore

---

## 10.1 Jump Pipeline

```text id="10tl6v"
① Suspend Current Window

② Build Target Window

③ Estimate Initial Spacer

④ Mount Target Messages

⑤ Wait Initial Measurement

⑥ Scroll To Anchor Message

⑦ Commit New AnchorState
```

---

## 10.2 Jump Initialization

初始化时：

允许：

```text id="86fj0m"
estimated heights
```

随后：

```text id="5axv4i"
incremental correction
```

不要等待：

```text id="nsvu8q"
所有消息精确测量完成
```

否则：

跳转 latency 会非常高。

---

# 11. React Integration

---

## 11.1 Runtime Isolation

核心 Runtime 必须脱离 React。

推荐：

```ts id="a7l2gk"
class MessageRuntime
```

负责：

- anchor
- measurement
- scroll
- trim
- stabilization

React 仅负责：

```text id="xql11m"
projection render
```

---

## 11.2 React Responsibilities

React：

```text id="gl55c2"
render(message)
```

Runtime：

```text id="syd2fq"
control viewport
```

两者不能互相拥有。

---

## 11.3 Concurrent Rendering Safety

禁止：

```text id="q31eeu"
React state 驱动 scroll recovery
```

原因：

Concurrent Rendering 无法保证：

```text id="zbknd4"
layout timing determinism
```

scroll stabilization 必须：

```text id="jlwmjj"
imperative + synchronous
```

---

# 12. Recommended Browser APIs

---

## Required

| API                   | Purpose                  |
| --------------------- | ------------------------ |
| ResizeObserver        | dynamic height           |
| requestAnimationFrame | atomic stabilization     |
| IntersectionObserver  | viewport anchor tracking |

---

## Recommended CSS

```css id="q7w5r3"
contain: layout paint;
content-visibility: auto;
contain-intrinsic-size: auto 40px;
```

---

## Avoid

避免：

```css id="c5s3xv"
will-change: transform;
```

用于 message container。

会导致：

- giant compositing layer
- raster invalidation
- memory growth

---

# 13. Non-goals

本 Runtime 不追求：

- 精确全局几何布局
- 极限 DOM 最小化
- transform virtualization
- 无限 cumulative coordinates
- recycle DOM pool

这些优化对 IM 的收益远低于：

```text id="jlwm0l"
viewport stability
```

---

# 14. Final Architecture Summary

Message Runtime 的本质：

不是：

```text id="jlwm7o"
Virtualization Engine
```

而是：

```text id="4qlbdx"
Deterministic Viewport Stabilization Runtime
```

核心设计：

| Principle                   | Description                     |
| --------------------------- | ------------------------------- |
| Flow-first                  | 浏览器负责 layout               |
| Anchor-first                | message identity 作为稳定坐标   |
| Runtime-owned scrolling     | runtime 接管 scroll semantics   |
| Atomic prepend/trim         | 所有 viewport mutation 原子提交 |
| Local measurement           | 局部测量而非全局几何            |
| Deterministic stabilization | 明确控制 scroll timing          |

该架构的目标不是：

```text id="jlwm49"
渲染最少 DOM
```

而是：

```text id="jlwm53"
在动态、高频、异步消息流中维持稳定视口
```
