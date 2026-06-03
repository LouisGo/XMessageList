# MessageList Session Registry

`src/x-message-list/core/session-registry` 是框架无关 runtime 之上的应用编排层。它掌管按 session/feed 维度的 `MessageListSession` 实例，并使其生命周期独立于 React 组件挂载状态。

## 职责

- 按 session/feed id 懒创建 `MessageListSession`。
- 通过 `getFeed` 和 `getAdapter` 解析应用级依赖。
- 掌管当前 session 的 loaded segment、视口状态、边缘状态、请求桥接、`anchorMemory` 和 `readReceipts` worker。
- 在向视口 runtime 发布 loaded segment 之前，执行请求 token、过期响应防护、segment 合并、裁剪和失败确认。
- 暴露精简的公开 session，包含 `getState`、`subscribe`、`commands`、`tail.local`、`tail.remote` 和 `rows`；runtime 内部实现保持为包内部。
- 应用分页缓存、持久化和脏时间戳检查保留在宿主 store 中。`rows.mutate` 按设计仅作用于已加载数据。

## 公开形态

应用在 app 层级创建一个 registry：

```ts
const registry = createMessageListSessionRegistry({
  defaults: {
    pageSize: 30,
    maxItems: 300,
    keepAlive: {
      maxSessions: 20,
      ttlMs: 10 * 60_000,
    },
  },
  scrollMotion: {
    enabled: () => deviceConfig.messageListMotionEnabled,
  },
  getFeed: (sessionId) => ({ id: sessionId }),
  getAdapter: (feed) => normalMessageAdapter,
})
```

`MessageList` 卸载时仅分离 DOM ref，不会销毁 session；registry 的保留策略或显式调用 `destroySession(sessionId)` 才掌管销毁。
