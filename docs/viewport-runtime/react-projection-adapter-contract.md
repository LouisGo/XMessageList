# React Projection Adapter 合同

## 1. Scope

本文档定义 React 如何连接 runtime。

目标是：

```text
React 负责渲染，runtime 负责 viewport。
```

React 不拥有 scroll recovery、measurement、window state machine。

React projection 也不能薄到把标准 IM viewport SOP 推给 demo。`src/react`
应该承接不涉及滚动算法的标准 shell 行为：

- 渲染 edge loading / exhausted / follow-bottom affordance。
- 把 follow-bottom 点击转换成 `runtime.dispatch({ type: 'followBottom' })`。
- 通过 runtime event 或 runtime-provided throttled signal 暴露 viewport anchor
  persistence callback。
- 保持 DOM 结构、data attributes、ref registry 和 commit ack 的标准化。

Demo / app 只提供业务 message JSX、文案/slot 和数据加载响应，不监听 raw scroll，
不 query projection DOM，不基于 `scrollTop` 判断分页。

## 2. Adapter Shape

推荐 hook：

```ts
function useMessageViewportRuntime(runtime: MessageViewportRuntime) {
  const subscribe = useCallback(
    (listener: RuntimeListener) => runtime.subscribe(listener),
    [runtime],
  );
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useLayoutEffect(() => {
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    });
  }, [runtime, snapshot.feedId, snapshot.generation, snapshot.revision]);

  return snapshot;
}
```

注意：

- `subscribe` 和 `getSnapshot` 必须是稳定引用，不能每次 render 重新 bind。
- `getSnapshot` 在 snapshot 未变化时必须返回同一对象引用。
- commit 回执用 `useLayoutEffect`，不是 `useEffect`。
- commit 回执只带 projection revision，不带 DOM measurement。

React 官方 `useSyncExternalStore` 文档将它定位为订阅外部 store 的 hook。这里 runtime snapshot 就是该外部 store。

`MessageViewport` 必须先调用该 hook，再在后续 layout effect 中执行
`runtime.attach(container)`。Container ref callback 只保存 DOM 引用，不能直接
attach。原因是 feed 切换 / staged activation 允许 runtime 在 React 挂载前已经
持有 data snapshot 和 pending bootstrap command；如果 ref callback 先 attach，
runtime 可能立刻发布 bootstrap projection，而 React 还没有建立 external-store
订阅与 commit ack 链路，最终导致 `commit-timeout-bootstrap`。

runtime prop 变化时，旧 runtime 的 `detach()` 必须发生在 React mutation
新 projection DOM 之前。否则同一个 scroll container 已经被换成新 feed
内容后，旧 runtime 再读取 `scrollTop` 会污染它自己的 retained scroll position，
下一次缓存命中就会恢复到错误位置。当前 adapter 用一个 class boundary 的
`getSnapshotBeforeUpdate` 承接 pre-mutation detach；新 runtime 仍在 layout
effect 中 attach。

## 3. Ref Registry

React row wrapper 必须注册 DOM。

```tsx
function MessageRowProjection(props: {
  item: MessageDataItem;
  runtime: MessageViewportRuntime;
  children: ReactNode;
}) {
  const key = getRuntimeItemKey(props.item);

  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      props.runtime.registerRow(key, element);
    },
    [props.runtime, key],
  );

  return (
    <div ref={setRef} data-message-row={serializeRuntimeItemKey(key)}>
      {props.children}
    </div>
  );
}
```

规则：

- ref callback 只注册 / 注销 DOM。
- ref callback 不测量。
- ref callback 不 dispatch command。
- row wrapper 不读写 scrollTop。

Spacer 和 sentinel 也通过 ref callback 注册：

```tsx
const setTopSentinel = useCallback(
  (element: HTMLDivElement | null) => runtime.registerTopSentinel(element),
  [runtime]
);
const setTopSpacer = useCallback(
  (element: HTMLDivElement | null) => runtime.registerTopSpacer(element),
  [runtime]
);
const setBottomSpacer = useCallback(
  (element: HTMLDivElement | null) => runtime.registerBottomSpacer(element),
  [runtime]
);
const setBottomSentinel = useCallback(
  (element: HTMLDivElement | null) => runtime.registerBottomSentinel(element),
  [runtime]
);

<div ref={setTopSentinel} data-top-sentinel />
<div ref={setTopSpacer} style={{ height: snapshot.topSpacer }} />
<div ref={setBottomSpacer} style={{ height: snapshot.bottomSpacer }} />
<div ref={setBottomSentinel} data-bottom-sentinel />
```

实际代码中这些 register 方法应先 bind 或包装成稳定 callback。

## 4. StrictMode Contract

React 18 StrictMode 开发环境会触发额外 mount / unmount 检查。Adapter 必须支持：

```text
attach(container)
detach()
attach(container)
```

要求：

- `attach` 幂等；同一个 container 重复 attach 不重复注册 observer。
- `detach` 幂等；不存在 observer 时不抛错。
- `destroy` 只在 feed runtime 彻底废弃时调用。
- `attach` 只能发生在 adapter 已经订阅 runtime snapshot 之后；不要在 ref
  callback 中 attach scroll container。
- runtime prop 变化时，旧 runtime 必须在 DOM mutation 前 detach，不能等
  layout effect cleanup。
- ref callback 收到 `null` 时只删除对应 DOM 引用，不清空 height cache。
- stale commit 回执必须按 `feedId + generation + revision` 丢弃。

## 5. Commit Ack Semantics

`notifyProjectionCommitted` 表示：

```text
React 已经把当前 snapshot 对应的 DOM 提交到浏览器树。
```

它不表示：

- 图片已经 decode。
- ResizeObserver 已经触发。
- 所有异步内容高度已经稳定。
- 用户没有继续滚动。

Runtime 收到 commit ack 后才能做第一轮同步测量。

## 6. Projection Component Boundary

React projection 允许：

- 渲染 message row。
- 渲染 unread marker。
- 渲染 loading edge。
- 渲染 bottom follow button。
- 订阅 runtime 的 view-level events 并把 anchor persistence signal 交给接入方。
- 处理 hover、selection、context menu 等局部交互。

React projection 禁止：

- 自己计算 RenderWindow。
- 自己维护 spacer。
- 自己根据 scrollTop 触发 prepend。
- 在 effect 里修正 scrollTop。
- 把 measured height 放进 React state。
- query runtime DOM 结构来持久化 anchor。
- 注册 raw scroll listener 来重建 scroll-idle / pagination timing。

## 7. Snapshot Granularity

React 应只订阅一个 projection snapshot。

不要拆成多个 React state：

```tsx
const [items, setItems] = useState(...);
const [topSpacer, setTopSpacer] = useState(...);
const [bottomSpacer, setBottomSpacer] = useState(...);
```

原因是 snapshot 中的 `items + renderWindow + spacer` 必须来自同一个 runtime revision。拆开后容易产生 spacer 与 DOM window 不匹配。

## 8. Event Flow

用户点击、快捷键、菜单：

```text
React event handler
-> action or runtime.dispatch(semantic command)
-> runtime transaction
-> snapshot publish
```

滚动事件：

```text
DOM scroll event
-> runtime scroll handler
-> optional snapshot publish
-> optional viewportAnchorChanged event
```

React 不转发 raw scroll event。Scroll listener 由 runtime 在 `attach` 时注册到 container。

`MessageViewport` 可以接收：

```ts
type MessageViewportProps = {
  renderMessage: (item: MessageDataItem) => ReactNode;
  renderTopEdge?: (snapshot: MessageViewportSnapshot) => ReactNode;
  renderBottomEdge?: (snapshot: MessageViewportSnapshot) => ReactNode;
  renderFollowBottom?: (input: {
    snapshot: MessageViewportSnapshot;
    followBottom: () => void;
  }) => ReactNode;
  onViewportAnchorChange?: (
    anchor: AnchorState | null,
    reason: 'scroll-idle' | 'transaction-settle',
  ) => void;
};
```

默认 follow-bottom affordance 只在 `bottomLockState === 'UNLOCKED'` 时出现，
点击只 dispatch semantic command，不直接写 `scrollTop`。

## 9. Fallback Policy

如果 React projection 抛错：

- React error boundary 负责展示错误 UI。
- runtime 不尝试修复 React render error。
- feed generation 不应被错误边界自动复用到新 projection。

如果 runtime transaction 抛错：

- runtime 发布 `viewportError` event。
- React 可以显示恢复按钮。
- 恢复按钮只发 `reset` 或 `bootstrap` command。
