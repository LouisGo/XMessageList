# React Projection Adapter 合同

## 1. Scope

本文档定义 React 如何连接 runtime。

目标是：

```text
React 负责渲染，runtime 负责 viewport。
```

React 不拥有 scroll recovery、measurement、window state machine。

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
- 处理 hover、selection、context menu 等局部交互。

React projection 禁止：

- 自己计算 RenderWindow。
- 自己维护 spacer。
- 自己根据 scrollTop 触发 prepend。
- 在 effect 里修正 scrollTop。
- 把 measured height 放进 React state。

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
```

React 不转发 raw scroll event。Scroll listener 由 runtime 在 `attach` 时注册到 container。

## 9. Fallback Policy

如果 React projection 抛错：

- React error boundary 负责展示错误 UI。
- runtime 不尝试修复 React render error。
- feed generation 不应被错误边界自动复用到新 projection。

如果 runtime transaction 抛错：

- runtime 发布 `viewportError` event。
- React 可以显示恢复按钮。
- 恢复按钮只发 `reset` 或 `bootstrap` command。
