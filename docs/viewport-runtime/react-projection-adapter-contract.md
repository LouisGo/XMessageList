# React Projection Adapter 合同

本文定义 React 如何连接 physical segment runtime。

核心边界：

```text
React renders projection.
Runtime owns viewport geometry.
CustomScrollbar renders UI but gets geometry from runtime.
```

## 1. Adapter Responsibilities

React adapter 负责：

- 订阅 projection snapshot。
- 渲染固定 DOM 结构。
- 通过 ref callback 注册 rows、spacers、sentinels。
- 在 layout effect 中发送 commit ack。
- 渲染 custom scrollbar overlay。
- 将 scrollbar pointer event 转成 runtime direct-scroll API。
- 渲染 edge loading / exhausted / follow-bottom / overlay slots。

React adapter 禁止：

- 根据 raw `scrollHeight` 计算 thumb。
- 根据 raw `scrollTop` 判断 bottom lock。
- 根据 raw scroll event 触发分页。
- 自己维护 spacer 或 render window。
- 在 effect 中修正 `scrollTop`。
- 把 measurement 放进 React state。

## 2. Projection Snapshot Subscription

```ts
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

要求：

- `subscribe` / `getSnapshot` 必须是稳定引用。
- commit ack 用 layout effect。
- commit ack 必须原样回传 `snapshot.commitToken`，不能重建一个只含 feed / generation / revision 的对象。
- commit ack 不携带 DOM measurement。
- runtime attach 必须发生在 adapter 已订阅 snapshot 之后。

## 3. Physical Metrics Subscription

Custom scrollbar 不应通过 projection snapshot 每帧 rerender。推荐单独订阅 physical metrics：

```ts
function usePhysicalScrollMetrics(runtime: MessageViewportRuntime) {
  return useSyncExternalStore(
    runtime.subscribePhysicalScroll,
    runtime.getPhysicalScrollMetrics,
    runtime.getPhysicalScrollMetrics,
  );
}
```

如果实现选择 rAF imperative sync，也必须从 runtime 读取 `PhysicalScrollMetrics`，不能从 DOM `scrollHeight` 推导可见 thumb 语义。

Adapter 可以把 runtime 提供的 `domScrollHeight` 作为校验字段，但不能用裸 DOM `scrollHeight` 覆盖 runtime 的 `physicalWindowSize`。稳定帧中二者不一致时，应依赖 runtime diagnostics，而不是在 React 层修正。

## 4. DOM Structure

```tsx
<div data-message-viewport data-custom-scrollbar="true">
  <div data-message-scroll-container>
    <div data-top-sentinel />
    <div data-top-spacer style={{ height: snapshot.topSpacer }} />
    <div data-message-window>
      {snapshot.items.map(renderRow)}
    </div>
    <div data-bottom-spacer style={{ height: snapshot.bottomSpacer }} />
    <div data-bottom-sentinel />
  </div>
  <CustomScrollbar runtime={runtime} />
</div>
```

规则：

- native scrollbar hidden by CSS。
- scroll container 仍是实际 `scrollTop` surface。
- row / spacer / sentinel ref callback 只注册 DOM。
- ref callback 不测量、不 dispatch、不写 scrollTop。

## 5. Custom Scrollbar Contract

Scrollbar pointer flow：

```text
pointerdown thumb
-> runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
-> pointermove
-> runtime.writeDirectScrollTop(nextPhysicalScrollTop, ...)
-> pointerup
-> runtime.endDirectScroll(...)
```

Track click：

```text
click track
-> compute target inside physical metrics
-> runtime.writeDirectScrollTop(target, { source: 'custom-scrollbar-track' })
```

Custom scrollbar 可以在本地计算 thumb style，但只能使用 `PhysicalScrollMetrics`：

```text
physicalSegmentId, physicalSegmentRevision,
viewportSize, physicalWindowSize, domScrollHeight, scrollPosition,
maxScrollPosition, scrollHeightCap, capMode,
safeScrollRangeStart, safeScrollRangeEnd,
isThumbFrozen, isMomentumLatched, suppressedMomentumDeltaPx,
isSegmentShiftPending, pendingShiftDirection, pendingEdgeOverflowPx
```

禁止读取：

- DataWindow item count
- projected item count
- cumulative spacer meaning
- business pagination state

## 6. Runtime Prop Change

runtime prop 变化时：

```text
old runtime detach before DOM mutation
new runtime attach after subscription is ready
```

这样可以避免旧 runtime 读取新 feed DOM，污染 retained scrollTop / anchor。

## 7. StrictMode

Adapter must support:

```text
attach(container)
detach()
attach(container)
```

`detach` preserves runtime cache. `destroy` is only for host-level disposal.

## 8. Events

React forwards semantic events only:

- `viewportAnchorChanged`
- `viewportReady`
- `viewportError`
- `needMoreBefore`
- `needMoreAfter`
- `needLatestMessages`
- `needMessagesAround`
- `destinationSettled`
- `viewportDiagnostic`

React does not forward raw scroll events. Runtime owns scroll listeners.

## 9. Follow Bottom UI

Default follow-bottom affordance depends on `snapshot.bottomLockState === 'UNLOCKED'`.

Do not infer latest lock from physical bottom. Runtime already applies:

```text
active segment role === latest && hasMoreAfter === false
```

Click handler only dispatches:

```ts
runtime.dispatch({ type: 'followBottom' });
```
