# 外部技术调研记录

本文记录对外部实现的取舍。它不是 API 合同，合同以前面几份 runtime 文档为准。

## 1. React Virtuoso

参考：

- Message List scroll modifier：https://virtuoso.dev/virtuoso-message-list/scroll-modifier/
- Message List DataMethods：https://virtuoso.dev/virtuoso-message-list-api/interfaces/DataMethods/
- Follow output：https://virtuoso.dev/virtuoso-api/interfaces/VirtuosoProps/#followoutput
- At bottom threshold：https://virtuoso.dev/virtuoso-api/interfaces/VirtuosoProps/#atbottomthreshold
- Unknown height prepend issue：https://github.com/petyosi/react-virtuoso/issues/947
- Prepend remount issue：https://github.com/petyosi/react-virtuoso/issues/663
- Reverse follow output discussion：https://github.com/petyosi/react-virtuoso/discussions/1079

### 可吸收观点

React Virtuoso 把“数据变化后该如何调整滚动”建模为显式 scroll modifier，而不是让组件 effect 猜测。这非常适合 IM 场景。

我们吸收为：

```ts
type ViewportEffect =
  | 'none'
  | 'prepend'
  | 'append'
  | 'items-change'
  | 'remove-from-start'
  | 'auto-scroll-to-bottom'
  | 'item-location'
  | 'reset';
```

在 TypeX runtime 中，这些语义不直接暴露给 React，而是进入 runtime transaction。

Virtuoso 对 prepend 的要求是数据集要保留旧列表头部连续性，否则无法维持 scroll position。这个约束应转化为 DataSnapshot invariant：prepend 不是任意 replace，必须能让 runtime 找到旧 anchor。

Virtuoso 的 `followOutput` 和 `atBottomThreshold` 说明追底应该是明确状态，而不是每次 append 都滚到底。我们吸收为 bottom lock hysteresis。

Virtuoso 的 prepend 相关 issue 暴露了通用虚拟列表在未知高度、overscan、prepend remount、React 18 下仍会遇到视觉跳动和闪烁。我们吸收为：

- prepend 必须是 transaction，不是单纯 data array unshift。
- commit 后必须有 anchor rect correction。
- mounted row continuity 是可测试合同。
- 未知高度必须通过估算 + 实测修正闭环，而不是假设库能完全隐藏。

### 不直接采用的点

不直接采用通用 virtual list 的全局 index 心智。

TypeX IM runtime 的核心坐标仍然是 message item key + viewport anchor。Index 只作为当前 DataSnapshot 内的派生值。

不直接采用把滚动策略作为 React prop 的模型。

TypeX 需要 runtime 脱离 React，因此 scroll modifier 的等价物应该是 data change effect + runtime command，而不是组件 prop 驱动。

## 2. Telegram Web A

参考：

- `MessageList.tsx`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/MessageList.tsx
- `MessageListHistoryHandler.tsx`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/MessageListHistoryHandler.tsx
- `useMessageObservers.ts`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/hooks/useMessageObservers.ts
- `useScrollHooks.ts`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/hooks/useScrollHooks.ts

### 可吸收观点

Telegram Web A 在 message list 周边大量使用 DOM refs、observer、scroll hooks 和历史加载 handler。真实 IM 工程并不会只靠 React state 解决滚动稳定性。

我们吸收为：

- React row wrapper 必须向 runtime 注册 DOM ref。
- IntersectionObserver 更适合做边缘触发和可见性辅助，不适合直接拥有 scroll correction。
- 历史加载和 viewport 修正必须分阶段，不要让 React render effect 同时承担数据加载和 scrollTop 修正。
- scroll 操作需要区分用户滚动和程序滚动。

### 不直接采用的点

不把复杂 hook 链作为 runtime 主体。

TypeX 的目标是让 runtime 脱离 React，所以 Telegram Web A 的经验应转译成 imperative runtime modules，而不是照搬 hook 分层。

## 3. Telegram Web K

参考：

- `bubbles.ts`：https://github.com/morethanwords/tweb/blob/master/src/components/chat/bubbles.ts

### 可吸收观点

Telegram Web K 的聊天 bubbles 实现体现了一个事实：成熟 IM 容器会直接面对 DOM、滚动容器、批量插入、清理和异步状态，而不是把它抽象成普通列表。

我们吸收为：

- message viewport runtime 是专用 IM 容器，不是通用虚拟列表包装。
- 批量 DOM 变化前后必须保存可恢复的视觉坐标。
- 清理旧会话 / 旧 peer 的异步回调是核心稳定性问题。

### 不直接采用的点

不照搬其具体 DOM 组织和业务混合方式。

TypeX runtime 必须保持业务消息渲染、数据读取和 viewport 逻辑分离。

## 4. Browser APIs

参考：

- MDN Resize Observer API：https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API
- web.dev ResizeObserver：https://web.dev/articles/resize-observer
- MDN Intersection Observer API：https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API

### 可吸收观点

ResizeObserver 适合观察 element 尺寸变化，但它的 callback 不应该直接写 scrollTop。Runtime 应把 ResizeObserver 作为 dirty signal，然后在 rAF 中合并处理。

IntersectionObserver 适合判断 sentinel 接近 viewport，但 callback 时序不能替代 transaction。

同步 DOM measurement 仍然需要存在，因为 React commit ack 后的第一轮 correction 要在用户可感知 jump 前完成。

## 5. React External Store

参考：

- `useSyncExternalStore`：https://react.dev/reference/react/useSyncExternalStore

### 可吸收观点

Runtime projection snapshot 是典型 external store。

React adapter 的关键不是“把 runtime state 放进 React”，而是让 React 在 render 阶段读取一个稳定 snapshot。

这要求：

- snapshot 未变化时保持对象引用稳定。
- subscribe 回调只通知 snapshot 变化。
- commit ack 用 layout effect 回到 runtime。

## 6. TypeX 取舍总结

| Topic            | Decision                                               |
| ---------------- | ------------------------------------------------------ |
| Core abstraction | IM viewport runtime, not generic virtual list          |
| React role       | Projection only                                        |
| Scroll semantics | command + data effect -> transaction                   |
| DOM refs         | React registers, runtime owns                          |
| Measurement      | sync read after commit + ResizeObserver dirty batching |
| Window           | anchor-centered sliding, index only local              |
| Spacer           | estimated range height + measured correction           |
| Bottom follow    | hysteresis bottom lock                                 |
| IO               | prefetch / visibility signal only                      |
| Lifecycle        | generation guard for every async callback              |
