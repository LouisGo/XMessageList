# Session Registry 目标架构与 API 调整方案

本文档描述 `MessageListSessionRegistry` 的目标架构和 public API 心智模型。
当前实现使用 canonical registry 命名，不保留 deprecated 兼容别名。

## 背景与结论

当前实现中，真正的消息列表实例是 `MessageListSession`。每个 session 独立持有
viewport runtime、data runtime、loaded segment、edge state、overlay、
`anchorMemory`、`readReceipts` 和 tail event 语义。Registry 的核心职责是按 id
创建、缓存、复用和销毁 session，并把 host 提供的 adapter、默认配置和 keepAlive
策略注入 session。

因此，目标架构不剥离这层生命周期容器。`registry` 表达的是 session identity 与
lifecycle registry/cache/factory，不是业务层的消息管理器，也不是 React adapter
的 owner。

借鉴 TanStack Query 的 API 哲学时，应借鉴 identity 和 lifecycle 模型，而不是照搬
`query` 命名：

- `queryKey` 的对应物是 `sessionId`。
- `QueryClient` 的对应物是 `MessageListSessionRegistry`。
- `useQuery` 的对应物不是一个新的 fetch hook，而是
  `registry.getSession(sessionId)` 与 `<MessageList session={session} />`。

## 核心心智

```text
MessageListSessionRegistry
  owns session identity, lazy creation, reuse, keepAlive and destruction

MessageListSession
  owns one feed-backed message-list instance

React Adapter
  projects an existing session into <MessageList />

Viewport Runtime + Data Runtime
  remain package-internal engines owned by each session
```

`MessageListSession` 是最小可渲染消息列表实例。chat、thread、AI sidebar、收藏夹
都应该表达为一个 session。差异来自 host 如何为该 session id 选择 adapter、
request route、anchor memory 和 read receipt 行为，而不是来自 React 或 runtime
额外分支。

## Session Identity

目标 public 术语统一使用 `sessionId`。在 TypeX Electron 业务里，`feed_id` 可以
保证全局唯一，因此 `feed_id` 可以直接作为 `sessionId`：

```ts
const session = registry.getSession(feedId)
```

当前 runtime、segment、anchor 和 viewport events 仍使用 `feedId` 表达消息流身份。
因此 public request/session context 同时暴露 `id`、`sessionId` 和 `feedId`：
`id` 与 `sessionId` 是同一个 registry key，`feedId` 是 runtime/message identity
字段。默认情况下 `sessionId === feedId`。如果未来同一个 feed 需要多个独立 view
scope，必须把 `sessionId` 扩展为包含 view scope，同时继续把真实 feed 身份保留在
`feedId`，不能把 scoped session id 写入 message identity anchor。

这个约定覆盖以下场景：

- 分屏同时展示两个 chat 消息列表：两个不同 `feed_id`，两个独立 session。
- 同时展示 chat 与 thread：thread 本质仍是另一条 feed，用自己的 `feed_id`。
- 同时展示 chat 与侧边栏 AI 消息列表：AI 列表也有自己的 `feed_id`。
- 收藏夹或其他固定列表：使用固定且全局唯一的 `feed_id` 或固定 session id。

如果未来出现同一个 `feed_id` 需要同时承载两个独立滚动状态或不同 loaded segment
语义的场景，必须扩展 session identity，例如加入 view scope 或 list kind。只要
`feed_id` 继续保持全局唯一且一条 feed 只对应一个 session 状态，就不需要额外
namespace。

## Registry Ownership And Lifecycle

`MessageListSessionRegistry` 应由 app host 持有，通常是一个 renderer window 或一个
消息域 provider 下的稳定单例。它不能在 React render 中重复创建；如果需要接入
React，应在 app bootstrap、root store、dependency container 或稳定 memo 中创建。

目标生命周期规则：

- host 创建 registry，并在 window teardown、账号退出、workspace 切换或消息域卸载时
  调用 `registry.destroyAll()`。
- React adapter 在 `<MessageList />` mount 时自动 retain 对应 session，unmount 时
  release；mounted session 不参与 LRU 淘汰。
- host 可以通过 `registry.retainSession(sessionId, reason)` 保留一个未挂载但仍处于
  业务活跃状态的 session，例如分屏预加载、悬浮窗口或即将切回的 feed。
- `registry.sweep()` 执行 TTL 清理；`getSession()` 和配置更新后可以自动触发一次
  sweep。
- `destroySession(sessionId)` 是显式销毁：取消 timers、释放 runtime/data runtime、
  清空 read receipt worker 和 overlay 状态，并从 registry 删除。
- `maxSessions` 是缓存容量，不是活跃 session 数。它只约束 unmounted 且未被 host
  retain 的 cached sessions。
- 当前实现已经按 cached session 计数执行 LRU；mounted 或 host-retained session 不计入
  `maxSessions`，但仍可被显式 `destroySession(sessionId)` 销毁。

目标 registry surface：

```ts
type MessageListSessionRetainReason =
  | 'active-feed'
  | 'split-view'
  | 'prefetch'

type MessageListSessionRegistry<Row, Feed = MessageListFeedId> = {
  getSession(sessionId: MessageListSessionId): MessageListSession<Row>
  hasSession(sessionId: MessageListSessionId): boolean
  destroySession(sessionId: MessageListSessionId): boolean
  destroyAll(): void
  getSessionIds(): MessageListSessionId[]
  getSessionMeta(sessionId: MessageListSessionId): MessageListSessionRegistryEntry | null
  retainSession(sessionId: MessageListSessionId, reason: MessageListSessionRetainReason): () => void
  updateOptions(options: MessageListSessionRegistryOptionsPatch<Row, Feed>): void
  sweep(): void
}
```

`MessageListSessionRegistryEntry` 至少应表达 `sessionId`、`createdAt`、
`lastUsedAt`、`mountedRetainCount`、`hostRetainCount` 和 `status`。
`status` 推荐为 `mounted | active | cached`：mounted 表示存在 React view，active
表示 host 仍认为该 feed 业务活跃，cached 表示仅为快速恢复保留。

## Configuration Updates

registry 需要支持配置更新，但不是所有配置都应该原地影响已有 session。

可动态更新并影响已有 session 的配置：

- `pageSize`：影响后续 latest/before/after/around request，不重写已经 loaded 的
  segment。
- `keepAlive.maxSessions` / `keepAlive.ttlMs`：立即影响后续 sweep 和 LRU 淘汰。
- `scrollMotion.enabled`：后续 scroll command 和 runtime motion 决策读取新策略。
- `tailEvents.getPageFocus` / `tailEvents.shouldFollowRemoteAppend`：后续
  `tail.remote.append` 决策读取新策略。
- `onRequestResult`：后续 request result 使用新 callback。

不建议原地更新已有 session 的配置：

- `maxItems`：这是 data runtime item budget。改动后应销毁并重建 session，或由未来
  明确的 `resizeItemBudget` API 处理。
- `getFeed` / `getAdapter` 对已有 session 的结果：feed context、row adapter、
  request route、anchor memory 和 read receipts 是 session identity 的一部分。
  如果这些语义变化，应 `destroySession(sessionId)` 后重新 `getSession(sessionId)`。

`updateOptions` 只接受动态配置 patch，不接受 `maxItems`、`getFeed` 或 `getAdapter`。
需要改变静态语义时，host 必须显式销毁相关 session，避免一个 session 在生命周期中
悄悄换 feed、adapter、anchor memory 或 read receipts。

## Public API 目标形态

package 根出口目标命名：

```ts
export {
  createMessageListSessionRegistry,
  MessageListSessionRegistryProvider,
  useMessageListSession,
  useMessageListState,
  MessageList,
}

export type {
  MessageListAdapter,
  MessageListAnchor,
  MessageListAnchorMemoryValue,
  MessageListFeedId,
  MessageListSessionId,
  MessageListIdentityRemap,
  MessageListLocalTailStageInput,
  MessageListRemoteTailAppendContext,
  MessageListRemoteTailAppendInput,
  MessageListRemoteTailAppendPolicy,
  MessageListTailAppendFollowDecision,
  MessageListTailAppendFollowInput,
  MessageListPage,
  MessageListRequestContext,
  MessageListRequestResult,
  MessageListResolvedAnchor,
  MessageListRowsMutation,
  MessageListRowsReplaceInput,
  MessageListRowsResetAroundInput,
	  MessageListScrollMotionConfig,
	  MessageListScrollToMessageOptions,
	  MessageListSession,
	  MessageListSessionContext,
	  MessageListSessionRegistry,
	  MessageListSessionRegistryEntry,
	  MessageListSessionRegistryOptions,
	  MessageListSessionRegistryOptionsPatch,
	  MessageListSessionRetainReason,
	  MessageListSessionState,
	  MessageListOverlayStatus,
	  EmptySlotInput,
  EdgeSlotInput,
  MessageListCommands,
  MessageListProps,
  MessageListRenderItem,
  MessageListRenderRowInput,
  MessageListStateEqualityFn,
  MessageListStateSelector,
  MessageListViewportAnchorChangeEvent,
  MessageListViewportObservationEvent,
  OverlayStatusInput,
  ScrollToLatestSlotInput,
}
```

对业务接入者可见的 id 不暗示它一定是 conversation。Public API 只保留
`MessageListSessionId` / `MessageListFeedId`、`MessageListSessionRegistry`、
`MessageListSessionRegistryProvider` 和 `tail.local` / `tail.remote` 口径。

## Registry API

目标 registry 创建方式：

```ts
const registry = createMessageListSessionRegistry<Message, Feed>({
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
  getFeed: (sessionId) => getFeedById(sessionId),
  getAdapter: (feed) => getAdapterForFeed(feed),
  tailEvents: {
    getPageFocus: () => document.hasFocus(),
    shouldFollowRemoteAppend: ({ pageFocused, bottomLockState, distanceToBottom }) =>
      pageFocused && (bottomLockState === 'LOCKED' || distanceToBottom <= 96),
  },
  onRequestResult: (result) => logMessageListRequest(result),
})
```

`getFeed` / `getAdapter` 是 session 创建时的 host dependency injection。
`SessionRegistry` 不拥有 host 的全量分页缓存、dirty timestamp、业务未读状态、
权限、免打扰或持久化；这些仍由 Electron app 的业务 store 负责。

## Session Contract

`MessageListSession<Row>` 继续是 React 渲染和业务操作的核心对象：

```ts
type MessageListSession<Row> = {
  id: MessageListSessionId
  getState(): MessageListSessionState<Row>
  subscribe(listener: () => void): () => void

  commands: {
    scrollToLatest(): void
    scrollToMessage(anchor: MessageListAnchor, options?: MessageListScrollToMessageOptions): void
    loadBefore(): void
    loadAfter(): void
    reloadLatest(): void
  }

  rows: {
    patch(rows: Row[]): void
    mutate(input: MessageListRowsMutation<Row>): void
    replace(input: MessageListRowsReplaceInput<Row>): void
    resetLatest(page: MessageListPage<Row>): void
    resetAround(input: MessageListRowsResetAroundInput<Row>): void
    applyIdentityRemap(remaps: MessageListIdentityRemap[]): void
    clear(): void
  }

  tail: {
    local: {
      stage(input: Row | Row[] | MessageListLocalTailStageInput<Row>): void
      patch(rows: Row[]): void
      applyIdentityRemap(remaps: MessageListIdentityRemap[]): void
    }
    remote: {
      append(input: Row | Row[] | MessageListRemoteTailAppendInput<Row>): void
    }
  }
}
```

`commands` 表示视口或请求意图。`rows` 表示 loaded segment 内普通 row 变更。
`tail.local` 表示本 renderer 发起的 send/retry optimistic tail 语义；
`tail.remote.append` 表示远端、服务端、SDK 或 main process 推送的 tail 新消息，
并携带 follow/preserve 策略进入 runtime transaction。`local` / `remote` 表达的是
事件来源，不是消息作者；其他端发送后同步回本端的 self-authored message 仍然走
`tail.remote.append`。

这些入口仍然保持 session 级隔离：不同 `sessionId` 下的 DOM 测量、scroll
correction、edge request、overlay、anchor memory 和 read receipt worker 互不共享。

## React API

React 目标模型保持显式 session 渲染：

```tsx
function ConversationPane({ feedId }: { feedId: string }) {
  const session = useMessageListSession<Message>(feedId)

  return (
    <MessageList
      session={session}
      renderRow={({ row }) => <MessageRow message={row} />}
    />
  )
}
```

Provider 只提供 registry：

```tsx
<MessageListSessionRegistryProvider registry={registry}>
  <ConversationPane feedId={activeFeedId} />
</MessageListSessionRegistryProvider>
```

`MessageList` 接收的是已经存在的 session；React adapter 不创建 runtime、不发 request、
不合并数据、不持久化 anchor、不运行 read receipts。

如果 host 已经直接持有 session，也可以绕过 provider：

```tsx
<MessageList session={session} renderRow={renderRow} />
```

## Activation And Event Fanout

registry 需要有 session 状态，但不应该变成全局消息事件总线。推荐分工是：

- app host 的 feed store / event store 接收 Electron/main/SDK 推送，负责 canonical
  cache、dirty timestamp、未读计数和跨列表业务策略。
- registry 只管理已经创建的 session 生命周期，不主动为所有 cached session 订阅
  重型 push stream。
- mounted 或 host-retained active session 可以接收即时视觉更新：host 将推送翻译成
  `session.tail.remote.append(...)`、`session.rows.mutate(...)` 或
  `session.tail.local.patch(...)`。
- cached session 默认不处理重型事件。host 只更新业务 store，并标记该 feed dirty；
  下次 session 激活、mount 或 reload 时再通过 request/dirty check 恢复。
- read receipts 只来自 viewport observation；没有 mounted view 的 session 不会产生
  新 observation，也不应该主动 mark read。
- edge paging 只由 mounted viewport runtime 的 semantic need events 触发；cached
  session 不应因为后台 push 自动分页。

`maxSessions: 20` 的含义是最多保留 20 个 session 状态用于快速恢复，不表示 20 个
session 都处于活跃计算状态。通常 Electron 同时 mounted 的 session 只有 1 到 2 个；
其余 cached session 只保留轻量内存状态，并可被 TTL 或 LRU 淘汰。

## 多实例与隔离规则

Electron 应用可以同时展示多个 message list。只要每个列表使用不同 `sessionId`
或全局唯一 `feed_id`，现有 session 边界天然支持隔离：

- 每个 session 有独立 viewport runtime 和 scroll container ownership。
- 每个 session 有独立 data runtime、request token、segment revision 和 trim。
- 每个 session 有独立 overlay loading/error 状态。
- 每个 session 有独立 `anchorMemory` load/save 上下文。
- 每个 session 有独立 read receipt batching worker。
- React 多个 `<MessageList />` 只是投影不同 session，不共享 DOM refs。

需要避免的是让同一个 `sessionId` 同时表达两个语义不同的列表。如果两个列表必须有
独立滚动状态、独立 loaded segment 或不同 request/adapter 语义，它们必须使用不同
session id。

## 命名状态

当前 public docs、demo 和测试样板使用 `registry` / `sessionId` / `feedId` 口径。
Runtime/data runtime 仍然不进入 package root public surface；React adapter 仍通过
package-internal session internals 访问 runtime/view store。

## 非目标

- 不把 XMessageList 改成通用虚拟列表。
- 不把 `MessageListSessionRegistry` 变成业务 feed store。
- 不让 React 直接拥有 request、merge、anchor persistence 或 read receipts。
- 不暴露 runtime snapshot、runtime event、loaded segment 或 data runtime 类型给业务。
- 不为了重命名改变 loaded segment native scroll、anchor correction 或 edge latch
  语义。
