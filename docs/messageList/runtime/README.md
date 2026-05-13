# Message Viewport Runtime 实现文档

本目录只描述 IM message list 滚动视图容器本身的实现方案。

它不重新解释：

- MessageIdentityAnchor 的跨层语义
- Data Runtime 的 around/latest 数据读取
- Bridge 合同
- legacy `@messageList` 迁移边界

这些内容继续以 `docs/messageList` 上层文档为准。

## Runtime 目标

这里的 runtime 是一个 renderer 内部的 imperative viewport engine。它拥有：

- scroll container attach / detach
- DOM row ref registry
- RenderWindow 计算
- top / bottom spacer
- measurement 和 height cache
- scroll intent classification
- bottom lock
- viewport transaction
- projection snapshot publish

React 只拥有：

- message row JSX
- unread marker / loading indicator / local interaction UI
- `useSyncExternalStore` 订阅 runtime snapshot
- 通过 ref callback 把 DOM 节点注册给 runtime
- commit 后回执 runtime

## 推荐阅读顺序

| 文档 | 何时阅读 | 核心问题 |
| --- | --- | --- |
| [runtime-container-architecture.md](./runtime-container-architecture.md) | 开始实现容器内核前 | runtime 由哪些模块组成，哪些状态能进 snapshot |
| [react-projection-adapter-contract.md](./react-projection-adapter-contract.md) | 写 React adapter / hook / row wrapper 前 | React 如何连接 runtime 而不拥有滚动逻辑 |
| [window-and-spacer-algorithms.md](./window-and-spacer-algorithms.md) | 实现 RenderWindow、trim、spacer 前 | window 怎么滑动，spacer 怎么估算和修正 |
| [transaction-and-scroll-timing.md](./transaction-and-scroll-timing.md) | 实现 prepend、append、jump、resize 前 | commit 后何时测量、何时修正 scrollTop |
| [lifecycle-and-testing.md](./lifecycle-and-testing.md) | 接入 feed 切换、StrictMode、测试前 | 如何清理异步资源，怎么写可验证测试 |
| [research-notes.md](./research-notes.md) | 需要理解外部参考如何取舍时 | React Virtuoso 与 Telegram Web 的可借鉴点 |

## 实现边界

Runtime 可以读写 DOM，但不渲染具体 message 内容。

Runtime 可以持有 message item key、height cache、window index，但不长期持有完整业务消息缓存。

Runtime 可以发布 projection snapshot，但不调用 React `setState`。React adapter 必须通过 `useSyncExternalStore` 或等价外部 store 语义订阅。

Runtime 可以请求“需要更多数据”的信号，但不直接调 SDK，不解析业务权限，不决定 around query 参数的服务端语义。

## 推荐最小代码形态

```ts
type MessageViewportRuntimeParts = {
  store: ProjectionStore;
  refs: RuntimeDomRegistry;
  window: RenderWindowEngine;
  measurement: MeasurementEngine;
  spacer: SpacerEngine;
  scroll: ScrollIntentEngine;
  transactions: ViewportTransactionRunner;
};
```

这些 parts 可以先做成一个 class 内的私有模块，不必过早拆包。文档里的模块边界用于约束 ownership，不要求一开始就形成复杂目录。

## 外部参考

本目录参考了：

- React `useSyncExternalStore` 官方文档：https://react.dev/reference/react/useSyncExternalStore
- React Virtuoso Message List scroll modifier 文档：https://virtuoso.dev/virtuoso-message-list/scroll-modifier/
- React Virtuoso Message List DataMethods：https://virtuoso.dev/virtuoso-message-list-api/interfaces/DataMethods/
- Telegram Web A `MessageList.tsx`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/MessageList.tsx
- Telegram Web A `useMessageObservers.ts`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/hooks/useMessageObservers.ts
- Telegram Web K `bubbles.ts`：https://github.com/morethanwords/tweb/blob/master/src/components/chat/bubbles.ts
- MDN Resize Observer API：https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API
- web.dev ResizeObserver 文章：https://web.dev/articles/resize-observer
