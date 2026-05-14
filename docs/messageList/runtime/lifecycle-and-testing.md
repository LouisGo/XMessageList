# Lifecycle 与测试合同

## 1. Scope

本文档定义 runtime 生命周期、异步资源清理、generation safety 和测试矩阵。

## 2. Generation Contract

每个 runtime 实例都必须带：

```ts
type RuntimeGeneration = {
  feedId: string;
  generation: number;
};
```

所有异步回调必须捕获 generation：

- commit ack
- requestAnimationFrame
- setTimeout
- ResizeObserver
- IntersectionObserver
- data snapshot response
- external event callback

回调执行前先检查：

```ts
if (!lifecycleGuard.isCurrent(feedId, generation)) return;
```

## 3. Attach / Detach / Destroy

`attach(container)`：

- 保存 container。
- 注册 scroll listener。
- 注册 container ResizeObserver。
- 注册 sentinel IntersectionObserver。
- 如已有 snapshot 且未 READY，继续 bootstrap。

`detach()`：

- 保存当前 container `scrollTop`，供同一 runtime 再次 attach 时恢复。
- 移除 scroll listener。
- disconnect container observer。
- disconnect row ResizeObserver。
- disconnect IntersectionObserver。
- cancel rAF。
- clear pending commit。
- 保留 feed generation 和可复用 height cache。

`destroy()`：

- 调用 detach。
- 清空 command queue。
- 清空 height cache。
- 清空 row registry。
- 清空 snapshot listeners。
- 标记 DESTROYED。

`detach` 用于 React projection 临时卸载；`destroy` 用于 runtime 彻底废弃。

## 3.1 Feed Runtime Cache

生产级 IM 页面不应该把 `MessageViewportRuntime` 绑定到单个 viewport 组件的
`useMemo` 生命周期上。更合理的 ownership 是：

- conversation / session host 按 `feedId` 持有 runtime cache。
- React projection 只接收当前 active runtime。
- feed 切走时 projection 对旧 runtime 执行 `detach()`，保留 height cache、
  anchor、scrollTop 和 projection snapshot。
- feed 切回且 runtime cache 命中时，不应重新 bootstrap 同一 runtime；host 只恢复
  该 feed 的本地 data-window/session state。
- LRU 淘汰、显式关闭会话或页面最终销毁时，host 才调用 `destroy()`。

缓存策略属于 app / demo policy，不属于 viewport runtime core。runtime core 只保证：

- 同一个 runtime 可经历 `attach -> detach -> attach`。
- `destroy()` 后拒绝继续接收 command / snapshot。
- 异步回调仍按 `feedId + generation` 丢弃 stale work。

React 18 StrictMode 下，host 如果在 effect cleanup 中释放 cache，必须延后一拍或
采用等价 guard，避免开发环境的模拟 cleanup 把仍会复用的 runtime 销毁。

## 4. Cleanup Order

推荐 teardown 顺序：

```text
mark generation inactive
-> stop accepting commands
-> cancel pending commit timeout
-> cancel rAF
-> disconnect observers
-> remove event listeners
-> clear DOM refs
-> publish terminal or reset snapshot if needed
```

先 mark inactive，可以阻止清理过程中排队的旧回调继续修改状态。

## 5. Command Queue Safety

```ts
type QueuedCommand = {
  id: string;
  generation: number;
  command: MessageRuntimeCommand;
  supersedeKey?: string;
};
```

规则：

- later jump supersedes earlier pending jump。
- reset supersedes all pending commands。
- generation change drops all pending commands。
- destroyed state rejects all commands。
- detached state queues only bootstrap/reset，其他命令拒绝或丢弃。

## 6. Observer Safety

Row ResizeObserver：

- 只 observe 当前 mounted row。
- row unmount 时 unobserve。
- observer callback 不持有 React fiber 或 component state。

IntersectionObserver：

- observe sentinels。
- root 使用 scroll container。
- detach 时 disconnect。

Container ResizeObserver：

- 宽度变化触发 resize transaction。
- 高度变化触发 viewportHeight 重新计算和 window threshold 更新。

## 7. Error Recovery

Runtime error 分三类：

| Error | Recovery |
| --- | --- |
| commit timeout | cancel transaction, request reset or retry projection once |
| anchor missing | nearest visible fallback, then reset if unavailable |
| DOM registry inconsistent | detach observers, force projection revision, wait commit |

Runtime 不吞掉不可恢复错误。它发布 `viewportError`，由上层决定显示恢复 UI 还是重建 runtime。

## 8. Unit Test Harness

纯 runtime 测试用 fake DOM adapter：

- fake container scroll metrics。
- fake row rect registry。
- fake rAF scheduler。
- fake ResizeObserver events。
- fake commit ack。

可测：

- command queue supersede。
- generation stale discard。
- spacer estimation。
- identity rebind cache migration。
- bottom lock hysteresis。
- snapshot revision 粒度。

## 9. Browser Integration Tests

真实浏览器测试必须覆盖：

- `scrollTop` correction。
- dynamic row height。
- ResizeObserver callback。
- IntersectionObserver prefetch signal。
- React commit ack timing。

推荐场景：

1. latest bootstrap 后处于 bottom locked。
2. 高视口 + 稀疏消息时，latest / followBottom window 不应退化成只挂 `minMountedItems` 条。
3. prepend 50 条动态高度消息，目标 anchor 视觉位置不变。
4. 图片 decode 后高度增长，anchor 上方变化时 scrollTop 补偿。
5. bottom locked 时 append 新消息，1 frame 内追底。
6. user scroll up 后 append 新消息，不追底。
7. jump 到历史消息，目标消息可见且有上下文。
8. feed 切换后旧 ResizeObserver 回调不污染新 feed。
9. StrictMode 下 attach/detach/attach 不重复 observer。
10. LRU 复用 feed runtime 时，切回未淘汰 feed 不丢失 projection/height cache。
11. LRU 淘汰 feed runtime 时必须调用 `destroy()`，被淘汰 feed 再切回走新 runtime + restore/latest。

## 10. Test Assertions

优先断言 observable behavior：

```ts
expect(anchorRectAfter.top).toBeCloseTo(anchorRectBefore.top, 1);
expect(distanceToBottom(container)).toBeLessThanOrEqual(LOCK_THRESHOLD_PX);
expect(snapshot.renderWindow.itemKeys).toContain(targetKey);
```

避免断言私有字段：

```ts
expect(runtime.privateTransaction.phase).toBe(...)
```

私有字段可以通过 debug API 在开发环境暴露，但测试不要依赖它们作为主要合同。

## 11. Debug Instrumentation

开发环境建议提供：

```ts
type RuntimeDebugSnapshot = {
  state: RuntimeState;
  activeTransaction?: string;
  pendingCommands: number;
  observedRows: number;
  heightCacheSize: number;
  lastScrollSource?: ScrollSource;
  lastCorrectionPx?: number;
};
```

Debug snapshot 不进入 React projection snapshot。

## 12. Performance Budgets

初始预算：

| Scenario                 | Budget                  |
| ------------------------ | ----------------------- |
| scroll handler JS        | < 2ms per rAF           |
| prepend correction       | same frame after commit |
| bottom follow            | <= 1 rAF after commit   |
| row ResizeObserver batch | coalesced per rAF       |
| mounted DOM rows         | prototype default <= 200; raise only after profiling |

超过预算时优先检查：

- 是否在 scroll event 内同步测量过多 row。
- 是否把 height cache 更新推入 React state。
- 是否频繁重建 observer。
- 是否 trim 太激进导致反复 mount/unmount。
