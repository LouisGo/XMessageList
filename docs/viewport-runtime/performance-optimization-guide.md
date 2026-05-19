# MessageViewport 性能优化指南

本文只覆盖当前 MessageViewport 场景：viewport runtime、React projection adapter、CustomScrollbar、mounted message rows、edge / follow-bottom slots。搜索页、会话列表、应用壳、独立 diagnostics 页面等外围 UI 不属于本文范围。

目标不是追新特性，而是在 Electron 41 + React 18+ 基线下，把 MessageViewport 的高频路径固定成少数可验证的性能规则。

## 1. Modern Electron 基线

为什么用：

MessageViewport 运行在受控 Electron renderer 中，Electron 41 已经提供现代 Chromium / V8 / Node 基线。这里不需要为旧浏览器设计多套滚动、observer 或 pointer fallback。

在哪些场景用：

- scroll container、ResizeObserver、IntersectionObserver、PointerEvent、requestAnimationFrame。
- CustomScrollbar drag / track click。
- physical metrics 采样、transaction timing、diagnostics trace。

怎么用：

```text
MessageViewport runtime
-> one modern DOM path
-> no legacy browser branch
-> diagnostics for invariant violation
```

一定不能做：

- 不要为了旧 Chromium 增加兼容分支。
- 不要在 viewport runtime core 中直接使用 Electron main / preload / Node API。
- 不要用 UA sniff 影响 segment、measurement、scrollbar 几何。
- 不要因为 Electron 版本新就跳过真实浏览器验证。

## 2. Projection Store 与 Metrics Store 分离

为什么用：

MessageViewport 有两类状态：低频 projection snapshot 和高频 physical metrics。把它们混在一个 React snapshot 里，会让普通 scroll frame 触发 row tree rerender。

在哪些场景用：

- `MessageViewportSnapshot`：驱动 rows、spacers、slots、commit token。
- `PhysicalScrollMetrics`：驱动 CustomScrollbar thumb、drag lock、segment shift/freeze/momentum 状态。

怎么用：

```tsx
function useMessageViewportRuntime(runtime: MessageViewportRuntime) {
  return useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
}

function usePhysicalScrollMetrics(runtime: MessageViewportRuntime) {
  return useSyncExternalStore(
    runtime.subscribePhysicalScroll,
    runtime.getPhysicalScrollMetrics,
    runtime.getPhysicalScrollMetrics,
  );
}
```

实现要求：

- `subscribe` / `getSnapshot` / `getPhysicalScrollMetrics` 必须是稳定引用。
- snapshot 未变化时必须返回同一个 immutable object。
- scroll frame 只更新 physical metrics store。
- projection revision 不因普通 scroll frame 递增。

一定不能做：

- 不要在 `getSnapshot` 中每次创建新对象。
- 不要把 mutable runtime 内部对象直接返回给 React。
- 不要让 CustomScrollbar 从 projection snapshot 推导每帧 thumb。
- 不要把 physical metrics 放进 React component state。

## 3. ProjectionCommitToken

为什么用：

MessageViewport 的 measurement 必须发生在 React projection 已提交之后。`ProjectionCommitToken` 让 runtime 知道具体哪个 `segmentRevision` 已经落到 DOM，避免 pending geometry 提前暴露给 CustomScrollbar。

在哪些场景用：

- bootstrap projection。
- segment shift projection。
- segment relayout projection。
- jump / restore / followBottom 构造 target segment。

怎么用：

```tsx
function useMessageViewportRuntime(runtime: MessageViewportRuntime) {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  useLayoutEffect(() => {
    runtime.notifyProjectionCommitted(snapshot.commitToken);
  }, [runtime, snapshot.commitToken]);

  return snapshot;
}
```

runtime 只在完整 token 匹配后才允许：

```text
measure rows
-> correct / rebase scrollTop
-> promote pending physical metrics
```

一定不能做：

- 不要用只包含 `feedId + generation + revision` 的旧 ack。
- 不要在 commit ack 前测量新 projection。
- 不要在 token ack 前把 pending `segmentRevision` 暴露为 committed metrics。
- 不要用 `flushSync` 绕过 commit token。

## 4. React 18 Automatic Batching

为什么用：

MessageViewport 内仍有少量低频 React UI：edge loading、exhausted slot、follow-bottom affordance、error slot。React 18 automatic batching 可以减少这些低频 UI 的重复 commit。

在哪些场景用：

- 同一个 runtime event 内更新 edge slot 和 loading slot。
- follow-bottom button 的显示状态变化。
- viewport error / empty / exhausted slot 更新。
- 不改变 physical metrics 的 projection-adjacent UI。

怎么用：

使用 React 18 client root，普通 React state 更新让 React 自动 batch：

```tsx
import { createRoot } from 'react-dom/client';

const root = createRoot(container);
root.render(<App />);
```

一定不能做：

- 不要依赖 batching 维护 transaction 顺序。
- 不要在 scroll frame 中 `setState` 驱动 row tree。
- 不要用 React state 表达 `scrollTop`、thumb position、drag lock、segment shift 状态。
- 不要把 batching 当成 row render 性能优化；row 性能靠 windowing、stable props 和 memoization。

## 5. CustomScrollbar Hot Path

为什么用：

CustomScrollbar 是 MessageViewport 最敏感的交互面。拖拽、thumb freeze、momentum latch 必须稳定，不能被 React row render 或 projection commit 阻塞。

在哪些场景用：

- thumb drag。
- track click。
- pointer capture / release。
- segment shift 前后的 thumb freeze。
- wheel / trackpad 边界 momentum latch。

怎么用：

```text
pointerdown
-> setPointerCapture(pointerId)
-> runtime.beginDirectScroll
-> pointermove writes current segment scrollTop through runtime
-> pointerup / pointercancel runtime.endDirectScroll + releasePointerCapture(pointerId)
```

实现要求：

- pointermove 直接调用 runtime direct-scroll API。
- thumb style 只读 `PhysicalScrollMetrics`。
- 高频 thumb position 可以用 rAF imperative sync，但数据源仍必须是 runtime metrics。
- thumb 可在 drag/freeze 期间使用 `transform` 更新。
- drag surface 应在交互期间禁止文本选择和浏览器手势干扰。

一定不能做：

- 不要在 pointermove 中 set React state。
- 不要从 DOM `scrollHeight` 或 DataWindow item count 计算 thumb。
- 不要让 ResizeObserver、motion、anchor correction 抢写 drag 中的 `scrollTop`。
- 不要把 `will-change` 长期开在整个 viewport 或 row tree 上；最多用于正在交互的 thumb。
- 不要让拖拽依赖未捕获的 pointer 事件。

## 6. Observer 与 rAF

为什么用：

MessageViewport 需要真实 layout 信号，但 observer callback 不是事务执行点。observer 只负责把 dirty signal 交给 runtime，真正的 geometry mutation 必须进入 transaction。

在哪些场景用：

- `ResizeObserver`：container / mounted row size dirty。
- `IntersectionObserver`：edge pre-signal / adjacent segment prefetch。
- `requestAnimationFrame`：合并 scroll frame metrics publish。
- Performance API：记录 long frame、transaction duration、diagnostic trace。

怎么用：

```text
ResizeObserver callback
-> mark height dirty
-> enqueue local correction or SegmentRelayout
```

```text
IntersectionObserver callback
-> mark adjacent prefetch need
-> emit semantic need event
-> keep current segment mounted
```

```text
scroll event
-> cache latest scrollTop
-> schedule one rAF metrics publish
```

一定不能做：

- 不要在 observer callback 中直接写 `scrollTop`。
- 不要在 observer callback 中直接替换 rows 或 spacer。
- 不要把 IO sentinel 当成 bottom lock truth。
- 不要每个 scroll event 都同步 publish projection snapshot。
- 不要把 diagnostics sampling 做成每帧 React rerender。

## 7. Message Row Rendering

为什么用：

Physical Segment Windowing 限制了 mounted rows 数量，但 mounted row 仍可能包含富文本、头像、附件、reaction、状态标记。row 渲染必须轻，且不能污染 runtime geometry。

在哪些场景用：

- message row component。
- avatar / sender block。
- rich text body。
- attachment preview。
- reaction / status / action affordance。

怎么用：

- row key 使用 `MessageRuntimeItemKey`。
- row props 保持最小、稳定、可比较。
- 昂贵子树用 `memo`，前提是 props 稳定。
- handler 用稳定引用，避免每次 projection render 都重建。
- content version 变化时显式触发 row 更新。

一定不能做：

- 不要用 render index 做 key。
- 不要在 row render 中读取 DOM layout。
- 不要在 row render 中发起 Bridge / SDK 请求。
- 不要把 height measurement 放进 React state。
- 不要为了 memoization 破坏 optimistic -> committed identity rebind。

## 8. Height Cache / Measurement Reuse

为什么用：

MessageViewport 会反复挂载、裁剪和重排同一批 message rows。对这些 row 的高度结果做缓存，可以减少重复测量和 relayout 成本，尤其在 segment shift、restore、jump 以及频繁 resize 后更明显。

在哪些场景用：

- `MessageRuntimeItemKey` 对应的 row 反复出现在不同 segment。
- 同一 message 在不同 projection revision 之间重复挂载。
- 需要预估 mountedRowsHeight、topSpacer、bottomSpacer 的场景。
- relayout 前后复用已经稳定的 row height。

怎么用：

- 缓存以 `MessageRuntimeItemKey` 为主键。
- 缓存应区分 `width bucket`、`content version` 和 `generation`。
- 先用缓存做估算，再用真实测量回写。
- measurement delta 只在 runtime transaction 内反向吸收或触发 relayout。

一定不能做：

- 不要把缓存当成真值，真实 measurement 仍然优先。
- 不要让旧 generation 的 height cache 污染新 feed。
- 不要在 content version 变化时继续复用旧高度。
- 不要让缓存回写绕过 `ProjectionCommitToken`。

## 9. CSS Containment

为什么用：

在现代 Chromium 中，适度 CSS containment 可以减少 message row 子树对外部 layout / paint 的影响。它是可选优化，只在真实 profiling 显示 row paint/layout 成本明显时使用。

在哪些场景用：

- 单条 message row 的复杂视觉子树。
- attachment preview / reaction cluster 这类局部复杂子组件。
- CustomScrollbar thumb 的 compositor-friendly transform。

怎么用：

```css
[data-message-row] {
  contain: layout paint;
}

[data-custom-scrollbar-thumb][data-dragging='true'] {
  will-change: transform;
}
```

使用前必须验证：

- row height measurement 仍准确。
- ResizeObserver 仍能观察动态高度变化。
- identity rebind / relayout 后没有残留 paint artifact。

一定不能做：

- 不要默认给 row 使用 `contain: size`，除非 row 高度是显式且稳定的。
- 不要默认使用 `content-visibility: auto` 隐藏 mounted rows；它可能干扰测量和 ResizeObserver 时序。
- 不要给整个 scroll container 长期开 `will-change: transform`。
- 不要用 CSS containment 代替 runtime windowing。

## 10. Transition / Deferred Value

为什么用：

对 MessageViewport 本体来说，`startTransition` / `useDeferredValue` 不是默认性能工具。它们只适合 viewport 内部确实存在的非关键、可延迟 UI，不能参与几何事务。

在哪些场景用：

- viewport 内置 diagnostics overlay 的筛选 UI。
- 非关键 hover metadata。
- 不影响 rows / spacer / metrics 的辅助 slot。

怎么用：

```tsx
startTransition(() => {
  setDiagnosticFilter(nextFilter);
});
```

如果 MessageViewport 当前没有这些重 UI，就不要引入 transition / deferred value。

一定不能做：

- 不要把 `SegmentShift`、`SegmentRelayout`、measurement、commit ack、scrollTop rebase 放进 transition。
- 不要 defer physical metrics、segment id、segment revision、anchor 或 bottom lock。
- 不要用 deferred value 触发 data request 或 edge need。
- 不要为了“使用 React 18 新特性”而引入额外状态层。

## 11. flushSync

为什么用：

在 MessageViewport 中，`flushSync` 基本不应该出现在常规路径。React commit 与 DOM measurement 的同步边界已经由 `ProjectionCommitToken` 表达。

在哪些场景用：

- 仅限非常窄的第三方 / 浏览器同步 API 边界。
- 临时验证某个同步 DOM 依赖的调试场景。

怎么用：

默认不用。必须使用时，代码旁边需要说明为什么 `ProjectionCommitToken + layout effect ack` 不足以解决。

一定不能做：

- 不要在 scroll handler、ResizeObserver、IntersectionObserver、pointermove 中调用。
- 不要用它推动 segment shift / relayout。
- 不要用它修复 commit timeout。
- 不要把它放进 append / prepend / projection refresh / followBottom 常规路径。

## 12. Browser Scroll Governance

为什么用：

MessageViewport 是受控滚动面，不需要浏览器替 runtime 做滚动锚定、滚动链传播或默认手势处理。现代 CSS 和 Pointer Events 足够把这些默认行为收敛到 viewport 自己的事务边界内。

在哪些场景用：

- scroll container 根节点。
- custom scrollbar thumb / track。
- 需要抑制浏览器默认拖拽语义的交互态。
- follow-bottom、wheel latch、segment shift 的 settle 边界。

怎么用：

```css
[data-message-scroll-container] {
  overflow-anchor: none;
  overscroll-behavior: contain;
}

[data-custom-scrollbar-thumb] {
  touch-action: none;
  user-select: none;
}
```

```ts
thumb.addEventListener('pointerdown', (event) => {
  thumb.setPointerCapture(event.pointerId);
});
```

实现要求：

- `overflow-anchor: none` 只放在 viewport 相关节点，不要扩散到整页。
- `overscroll-behavior` 只约束 MessageViewport 自己的滚动链，不要拿来代替 segment latch。
- `touch-action` 和 `user-select` 应至少覆盖 custom scrollbar interaction surface。
- `setPointerCapture` / `releasePointerCapture` 只服务 custom scrollbar 和明确需要连续 pointer 的交互。

一定不能做：

- 不要用 CSS 把浏览器默认滚动语义“盖掉”后再让 runtime 失去可观测性。
- 不要把这些属性当成几何修正手段。
- 不要在整页或消息 row 树上全局开启这些抑制项。
- 不要让 browser scroll anchoring 和 runtime anchor correction 同时拥有最终解释权。
- 不要在 pointercancel 上漏掉 direct scroll 收尾。

## 13. Listener Hygiene 与 Scrollend

为什么用：

MessageViewport 会频繁 attach / detach，并且在 StrictMode 下会经历重复挂载。稳定的事件监听生命周期能防止旧 generation 污染当前 viewport；`scrollend` 则可以作为 wheel / momentum 的收敛提示，而不是滚动控制本身。

在哪些场景用：

- scroll / wheel / pointer / resize / intersection 监听。
- runtime attach / detach / destroy。
- wheel momentum settle、drag release settle、follow-bottom settle。
- dev / diagnostics 中的事件清理验证。

怎么用：

```ts
const ac = new AbortController();

container.addEventListener('scroll', onScroll, {
  passive: true,
  signal: ac.signal,
});

container.addEventListener('scrollend', onScrollEnd, {
  signal: ac.signal,
});

// detach / destroy
ac.abort();
```

实现要求：

- `passive: true` 作为默认值，只有确实需要 `preventDefault()` 时才改成非 passive。
- 监听器必须绑定稳定 handler 或 runtime method，不要闭包捕获旧 generation 状态。
- `scrollend` 只能作为 settle hint，用来释放 latch、清理临时态或刷新诊断，不负责决定 edge 需要或 segment shift。
- `scrollend` 不可用时不补控制流 polyfill，回退到 transaction settle / rAF settle 语义。
- detach 时用 `AbortController` 一次性清理所有相关 listener，比逐个 remove 更不容易漏。

一定不能做：

- 不要保留匿名监听器跨 generation 存活。
- 不要让 wheel 监听器在整个 viewport 上默认非 passive。
- 不要把 `scrollend` 当作唯一的分页或 shift 触发器。
- 不要用旧闭包里的 scroll state 覆盖 runtime 当前状态。

## 14. Telemetry 与 Background Scheduling

为什么用：

MessageViewport 的正确性和性能都依赖“能看见发生了什么”。`performance.mark` / `measure` 和 `PerformanceObserver` 可以直接暴露长帧、布局抖动和事务耗时；`scheduler.postTask` 或 `requestIdleCallback` 则能把非关键工作移出输入热路径。

在哪些场景用：

- bootstrap、segmentShift、segmentRelayout、jump / restore、followBottom。
- diagnostics trace、cache pruning、adjacent prefetch bookkeeping。
- dev profiling、采样上报、异常回放。
- 非几何的辅助计算，比如低优先级元数据整理。

怎么用：

```ts
performance.mark('viewport:segment-shift-start', {
  detail: {
    physicalSegmentId,
    segmentRevision,
    scrollHeightCap,
    isDragLocked,
    segmentRelayoutState,
  },
});

performance.mark('viewport:segment-shift-end', {
  detail: { physicalSegmentId, segmentRevision },
});

performance.measure(
  'viewport:segment-shift',
  'viewport:segment-shift-start',
  'viewport:segment-shift-end',
);
```

```ts
scheduler.postTask(() => pruneDiagnosticsBuffer(), { priority: 'background' });
```

实现要求：

- `PerformanceObserver` 只收集和分析，不参与 runtime 决策。
- 观测对象优先包含 `long-animation-frame`、`longtask`、`layout-shift` 这类能暴露异常的条目；没有则降级为用户时序标记。
- 采样点放在 transaction 边界、commit ack、settle 完成点，不要放在每个 pointermove / scroll 事件上。
- `scheduler.postTask` 只承载软工作；如果实现没有该 API，才回退到 `requestIdleCallback` 或 `setTimeout(0)`。

一定不能做：

- 不要把 telemetry 变成 control flow。
- 不要在后台任务里直接改 `scrollTop`、spacer 或 segmentRevision。
- 不要把每帧诊断都推到 React rerender。
- 不要在热路径里创建大体积 trace payload。

## 15. 默认策略

MessageViewport 实现默认按这组策略执行：

```text
Projection snapshot -> useSyncExternalStore -> rows / spacers / slots
Physical metrics    -> separate store or rAF sync -> CustomScrollbar
Geometry mutation   -> runtime transaction -> ProjectionCommitToken -> measurement
Scroll frame        -> rAF coalescing -> metrics only
Rows                -> stable key + stable props + targeted memoization
Observers           -> dirty signals only
Browser governance   -> overflow-anchor / overscroll-behavior / pointer capture on interaction surfaces
Listeners           -> passive by default, abortable on detach
Telemetry           -> performance marks and observer sampling at transaction boundaries
Background work     -> postTask / idle only for soft work
Transition/deferred -> optional, only for non-critical in-viewport auxiliary UI
flushSync           -> not in normal path
```

验收时至少确认：

- scroll frame 不 rerender row tree。
- CustomScrollbar 不订阅 projection snapshot 做每帧几何。
- pending segmentRevision 在 commit token ack 前不暴露为 committed metrics。
- observer callback 不直接 mutate DOM geometry。
- pointermove 不进入 React state 热路径。
- mounted row measurement 不受 CSS containment 破坏。
- scroll container 禁用 browser scroll anchoring，custom scrollbar drag 使用 pointer capture。
- listeners 在 detach / destroy 时可一次性清理，`scrollend` 不作为 edge / shift 真值。
- telemetry 不在每帧采样，background task 不直接修改 viewport 几何。
- `flushSync` 不出现在 MessageViewport 热路径。

## References

- Electron 41 release notes: https://www.electronjs.org/blog/electron-41-0
- React 18 release notes: https://react.dev/blog/2022/03/29/react-v18
- `useSyncExternalStore`: https://react.dev/reference/react/useSyncExternalStore
- `useDeferredValue`: https://react.dev/reference/react/useDeferredValue
- `flushSync`: https://react.dev/reference/react-dom/flushSync
- `PerformanceObserver`: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver
- `scheduler.postTask`: https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/postTask
- `scrollend`: https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event
- `AbortController`: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- `setPointerCapture`: https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
- `overflow-anchor`: https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor
- `overscroll-behavior`: https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior
