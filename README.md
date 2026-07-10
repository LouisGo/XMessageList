# XMessageList

面向 TypeX 风格聊天界面的确定性 IM 消息列表实现。它并非通用虚拟列表：当前已加载分段以正常文档流渲染，内部 runtime 则掌管原生滚动语义、视觉锚点修正、DOM 测量、边缘请求、诊断与 evidence。

公开集成模型为：应用级 session registry + 按 `sessionId` 的 session + React 投射适配器。应用通过适配器一次性配置 `request`、`row`、`anchorMemory` 和 `readReceipts` 行为；React 负责渲染已有的 `MessageListSession`。

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:pack
npm run build:demo
npm run e2e:correctness
npm run e2e:perf
```

## 源码结构

- `src/x-message-list/core/session-registry`：应用编排层。按 `sessionId` 懒创建 `MessageListSession`，路由适配器，掌管请求桥接、Loaded Segment Store、keepAlive 保留、`anchorMemory` 和 `readReceipts`。
- `src/x-message-list/core/runtime`：框架无关的视口 runtime。消费已发布的 loaded segment，序列化投射事务，掌管 DOM ref/测量，写入 `scrollTop`，保持视觉锚点，发出 need 事件并报告诊断/evidence。
- `src/x-message-list/react`：React 18 投射适配器。从 provider context 解析 session，渲染行/插槽/可选浮层，注册 ref，挂载原生滚动容器并在 layout effect 中确认投射提交。
- `src/demo`：本地 mock 宿主与场景接线，涵盖 feed、边缘请求、动态高度、乐观重映射、事件风暴和 bot 推送。
- `src/e2e-app` 与 `e2e/runner`：真实浏览器桥接、evidence、oracle、正确性及性能通道。
- `docs`：架构、实现约束、交互规约、测试合约、图表及研究笔记。

## 最小示例

```tsx
import {
  MessageList,
  MessageListSessionRegistryProvider,
  createMessageListSessionRegistry,
  useMessageListSession,
  type MessageListAdapter,
} from 'x-message-list'

type SessionSource = {
  id: string
}

const messageAdapter: MessageListAdapter<MyMessage, SessionSource> = {
  row: {
    getKey: (message) => message.id,
    getAnchor: (message) => ({ id: message.id }),
    getVersion: (message) => message.version,
    getKind: (message) => message.type,
  },
  request: {
    loadLatest,
    loadBefore,
    loadAfter,
    loadAround,
  },
  anchorMemory: {
    load: ({ sessionId }) => loadSavedAnchor(sessionId),
    save: ({ sessionId }, value) =>
      saveAnchor(sessionId, value.anchor, value.offsetWithinMessage),
  },
  readReceipts: {
    batchDelayMs: 120,
    shouldMarkRead: (message) => !message.read,
    markRead: (messages) => markMessagesRead(messages),
  },
}

const registry = createMessageListSessionRegistry<MyMessage, SessionSource>({
  defaults: {
    pageSize: 30,
    retention: 'balanced',
    keepAlive: {
      maxSessions: 20,
      ttlMs: 10 * 60_000,
    },
  },
  scrollMotion: {
    enabled: () => deviceConfig.messageListMotionEnabled,
  },
  getSessionSource: (sessionId) => getSessionSourceById(sessionId),
  getAdapter: () => messageAdapter,
})

export function App() {
  return (
    <MessageListSessionRegistryProvider registry={registry}>
      <ConversationView sessionId="feed-1" />
    </MessageListSessionRegistryProvider>
  )
}

function ConversationView({ sessionId }: { sessionId: string }) {
  const session = useMessageListSession<MyMessage>(sessionId)

  return (
    <MessageList
      session={session}
      renderRow={({ row }) => <MessageRow message={row} />}
      renderBeforeStatus={({ status, retry }) => ...}
      renderAfterStatus={({ status, retry }) => ...}
      renderTopPlaceholder={() => ...}
      renderOverlayStatus={({ status }) => ...}
      renderEmpty={({ reload }) => ...}
      renderScrollToLatest={({ visibleByScroll, scrollToLatest }) => ...}
    />
  )
}
```

## 公开契约

- 包根导出 `createMessageListSessionRegistry`、`MessageListSessionRegistryProvider`、`useMessageListSession`、`useMessageListState`、`MessageList` 以及公开的 registry/session/React 契约类型；不保留 deprecated 兼容别名。
- 包根不导出 `createMessageListRuntime`、`MessageListRuntime`、`MessageListSnapshot`、`MessageListRuntimeEvent`、`LoadedSegment`、`MessageDataItem`、loaded segment store 类型或 `x-message-list/data` 子路径。
- `MessageListSessionRegistry` 掌管所有 `sessionId` 关联的 session。`MessageList` 卸载时仅分离视图，不会销毁 session。
- 应用 store 仍然是分页消息缓存、持久化和脏时间戳检查的规范持有者。XMessageList session 仅掌管当前 loaded segment、边缘状态、视口状态和已加载行的变更。
- `MessageListSession` 仅暴露公开应用命令和本地行变更入口：`commands.scrollToLatest`、`commands.scrollToMessage`、`commands.loadBefore`、`commands.loadAfter`、`commands.reloadLatest`、`commands.reloadCurrent`、`getState`、`subscribe`、`rows.patch`、`rows.mutate`、`rows.replace`、`rows.resetLatest`、`rows.resetAround`、`rows.applyIdentityRemap` 和 `rows.clear`。
- Host 无法用局部 mutation 证明窗口结构正确时调用 `commands.reloadCurrent({ reason: 'structural' })`；只有返回 `applied` 才表示对应 projection 已完成 DOM settle。
- React 是 `MessageListSession` 之上的适配器；它不得调用 request API、合并数据、持久化锚点或执行已读回执。
- Runtime 和 Loaded Segment Store 保持为包内部实现细节。

React 锁定在 `18.3.1` 以匹配当前 TypeX 渲染包。
