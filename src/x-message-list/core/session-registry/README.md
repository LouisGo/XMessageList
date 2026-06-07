# MessageList Session Registry

`src/x-message-list/core/session-registry` 是框架无关 runtime 之上的应用编排层。它掌管按 `sessionId` 维度的 `MessageListSession` 实例，并使其生命周期独立于 React 组件挂载状态。

## 职责

- 按 `sessionId` 懒创建 `MessageListSession`。
- `getSession(sessionId)` 只同步创建或复用 session；首次 `MessageList` mount retain、
  `retainSession(...)` 或 command/retry/reload 才启动 bootstrap/request 副作用。
- 通过 `getSessionSource` 和 `getAdapter` 解析应用级依赖。
- 掌管当前 session 的 loaded segment、视口状态、边缘状态、请求桥接、`anchorMemory` 和 `readReceipts` worker。
- 在向视口 runtime 发布 loaded segment 之前，执行请求 token、过期响应防护、segment 合并、裁剪和失败确认。
- 通过 `loaded-segment-store/` 持有 Loaded Segment Store；viewport runtime 只消费发布后的 segment。
- 维护 `loaded.context = latest | history | around`，把 loaded rows 的语义上下文
  和 viewport `bottomLockState` 分开。
- 暴露精简的公开 session，包含 `getState`、`subscribe`、`commands`、`tail.local`、`tail.remote` 和 `rows`；runtime 内部实现保持为包内部。
- 应用分页缓存、持久化和脏时间戳检查保留在宿主 store 中。`rows.mutate` 按设计仅作用于已加载数据。
- 对 latest page、`reachedLatest`、tail local/remote 的 public contract violation
  发出稳定 diagnostic，并保持违规路径不修改 loaded rows。

## 公开形态

应用在 app 层级创建一个 registry：

```ts
const registry = createMessageListSessionRegistry({
  defaults: {
    pageSize: 32,
    retention: 'balanced',
    keepAlive: {
      maxSessions: 20,
      ttlMs: 10 * 60_000,
    },
  },
  scrollMotion: {
    enabled: () => deviceConfig.messageListMotionEnabled,
  },
  getSessionSource: (sessionId) => ({ id: sessionId }),
  getAdapter: (source) => normalMessageAdapter,
})
```

`MessageList` 卸载时仅分离 DOM ref，不会销毁 session；registry 的保留策略或显式调用 `destroySession(sessionId)` 才掌管销毁。
