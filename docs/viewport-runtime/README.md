# Message Viewport Runtime 实现文档

本目录只描述 IM message list 滚动视图容器本身的实现方案。

它不重新解释：

- MessageIdentityAnchor 的跨层语义
- Data Runtime 的 around/latest 数据读取
- Bridge 合同
- legacy `@messageList` 迁移边界

这些内容继续以 `docs/architecture` 和 `docs/typex-transition` 文档为准。

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
- unread marker / loading indicator / bottom-follow affordance / local interaction UI
- `useSyncExternalStore` 订阅 runtime snapshot
- 通过 ref callback 把 DOM 节点注册给 runtime
- 在订阅建立后 attach scroll container，避免 pending bootstrap projection 丢失 commit ack
- commit 后回执 runtime

`src/react` 不是 demo-only 的薄包装。它应该提供标准 IM viewport shell：

- 固定 projection DOM 结构。
- edge loading / exhausted / follow-bottom 的可插槽渲染。
- 将 follow-bottom UI 事件转换为 runtime semantic command。
- 将 runtime 产生的 viewport anchor persistence signal 透传给接入方。

Demo 只负责 fake data、业务消息渲染、调试按钮和日志，不监听 raw scroll，
不 query runtime DOM，也不重建 viewport timing。

## 推荐阅读顺序

| 文档 | 何时阅读 | 核心问题 |
| --- | --- | --- |
| [runtime-container-architecture.md](./runtime-container-architecture.md) | 开始实现容器内核前 | runtime 由哪些模块组成，哪些状态能进 snapshot |
| [react-projection-adapter-contract.md](./react-projection-adapter-contract.md) | 写 React adapter / hook / row wrapper 前 | React 如何连接 runtime 而不拥有滚动逻辑 |
| [window-and-spacer-algorithms.md](./window-and-spacer-algorithms.md) | 实现 RenderWindow、trim、spacer 前 | window 怎么滑动，spacer 怎么估算和修正 |
| [transaction-and-scroll-timing.md](./transaction-and-scroll-timing.md) | 实现 prepend、append、jump、resize 前 | commit 后何时测量、何时修正 scrollTop |
| [scroll-motion-and-animation.md](./scroll-motion-and-animation.md) | 实现 follow-bottom / jump 动画前 | 为什么不用原生 smooth，如何做 bounded runtime motion |
| [lifecycle-and-testing.md](./lifecycle-and-testing.md) | 接入 feed 切换、StrictMode、测试前 | 如何清理异步资源，怎么写可验证测试 |
| [research-notes.md](./research-notes.md) | 需要理解外部参考如何取舍时 | React Virtuoso 与 Telegram Web 的可借鉴点 |

## 实现边界

Runtime 可以读写 DOM，但不渲染具体 message 内容。

Runtime 可以持有 message item key、height cache、window index，但不长期持有完整业务消息缓存。

Runtime 可以发布 projection snapshot，但不调用 React `setState`。React adapter 必须通过 `useSyncExternalStore` 或等价外部 store 语义订阅。

Runtime 可以请求“需要更多数据”的信号，但不直接调 SDK，不解析业务权限，不决定 around query 参数的服务端语义。

Data runtime / BFF 负责把 `MessageIdentityAnchor` 解析为当前
`MessageDataSnapshot` 内可定位的 anchor，包括 deleted anchor 的 nearest
neighbor fallback。Viewport runtime 只做 projection 内的 DOM fallback：目标行已
在 snapshot 中但 commit 后不可测量时 retry 或选择已挂载的 nearest measurable row。

## 当前代码形态

```ts
type MessageViewportRuntimeParts = {
  facade: MessageViewportRuntime;
  controller: MessageViewportRuntimeController;
  projection: ProjectionCoordinator;
  commit: CommitCoordinator;
  transactions: ViewportTransactionController;
  anchors: AnchorCoordinator;
  edges: EdgeNeedCoordinator;
  motion: DestinationMotionCoordinator;
};
```

早期 vertical slice 允许这些 parts 先做成一个 class 内的私有模块；当前实现已经越过原型阶段，`src/runtime/MessageViewportRuntime.ts` 只保留 public facade，核心接线进入 `core/MessageViewportRuntimeController.ts`，transaction / anchor / edge / motion / projection / commit 各自进入独立 coordinator。

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
