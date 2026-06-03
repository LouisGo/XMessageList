# XMessageList

Deterministic IM message-list implementation for TypeX-style chat surfaces. It
is not a generic virtual list: the current loaded segment is rendered in normal
document flow, while the internal runtime owns native scroll semantics,
visual-anchor correction, DOM measurement, edge requests, diagnostics and
evidence.

The public integration model is application-level session registry +
per-feed session + React projection adapter. Applications configure `request`, `row`,
`anchorMemory` and `readReceipts` behavior once through adapters; React renders
an existing `MessageListSession`.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:demo
npm run e2e:correctness
npm run e2e:perf
```

## Source Layout

- `src/x-message-list/core/manager`: application orchestration. It lazily
  creates one `MessageListSession` per session/feed id, routes adapters, owns
  request bridging, keepAlive retention, `anchorMemory` and `readReceipts`.
- `src/x-message-list/core/runtime`: framework-independent viewport runtime and
  internal data runtime. It consumes already-merged loaded segments, serializes
  projection transactions, owns DOM refs/measurement, writes `scrollTop`,
  preserves visual anchors, emits need events and reports diagnostics/evidence.
- `src/x-message-list/react`: React 18 projection adapter. It resolves sessions
  from provider context, renders rows/slots/optional overlay, registers refs,
  attaches the native scroll container and acks projection commits in layout
  effects.
- `src/demo`: local mock host and scenario wiring for feeds, edge requests, dynamic height, optimistic remap, event storms, and bot push.
- `src/e2e-app` and `e2e/runner`: real-browser bridge, evidence, oracle, correctness, and perf lanes.
- `docs`: architecture, implementation constraints, interaction specs, testing contracts, graphs, and research notes.

## Minimal Usage

```tsx
import {
  MessageList,
  MessageListSessionRegistryProvider,
  createMessageListSessionRegistry,
  useMessageListSession,
  type MessageListAdapter,
} from 'x-message-list'

const messageAdapter: MessageListAdapter<MyMessage, Conversation> = {
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
    load: ({ id }) => loadSavedAnchor(id),
    save: ({ id }, anchor, offsetWithinMessage) =>
      saveAnchor(id, anchor, offsetWithinMessage),
  },
  readReceipts: {
    batchDelayMs: 120,
    shouldMarkRead: (message) => !message.read,
    markRead: (messages) => markMessagesRead(messages),
  },
}

const registry = createMessageListSessionRegistry<MyMessage, Feed>({
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
  getAdapter: () => messageAdapter,
})

export function App() {
  return (
    <MessageListSessionRegistryProvider registry={registry}>
      <ConversationView feedId="feed-1" />
    </MessageListSessionRegistryProvider>
  )
}

function ConversationView({ feedId }: { feedId: string }) {
  const session = useMessageListSession<MyMessage>(feedId)

  return (
    <MessageList
      session={session}
      renderRow={({ row }) => <MessageRow message={row} />}
      renderBeforeStatus={({ status, retry }) => ...}
      renderAfterStatus={({ status, retry }) => ...}
      renderTopPlaceholder={() => ...}
      renderOverlayStatus={({ status }) => ...}
      renderEmpty={({ reload }) => ...}
      renderScrollToLatest={({ visible, scrollToLatest }) => ...}
    />
  )
}
```

## Public Contracts

- Package root exports `createMessageListSessionRegistry`,
  `MessageListSessionRegistryProvider`, `useMessageListSession`,
  `useMessageListState`, `MessageList` and public registry/session/React
  contract types. `createMessageListManager` and `MessageListProvider` remain as
  deprecated aliases during migration.
- Package root does not export `createMessageListRuntime`, `MessageListRuntime`,
  `MessageListSnapshot`, `MessageListRuntimeEvent`, `LoadedSegment`,
  `MessageDataItem`, data runtime types, or a `x-message-list/data` subpath.
- `MessageListSessionRegistry` owns all feed-backed sessions. `MessageList` unmount
  detaches the view but does not destroy the session.
- Application stores remain the canonical owner for paged message caches,
  persistence and dirty timestamp checks. XMessageList sessions own only the
  current loaded segment, edge state, viewport state and loaded-only row
  mutations.
- `MessageListSession` exposes only public application commands and local row
  mutation entry points: `commands.scrollToLatest`, `commands.scrollToMessage`,
  `commands.loadBefore`, `commands.loadAfter`, `commands.reloadLatest`,
  `getState`, `subscribe`, `rows.patch`, `rows.mutate`, `rows.replace`,
  `rows.resetLatest`, `rows.resetAround`, `rows.applyIdentityRemap` and
  `rows.clear`.
- React is an adapter over `MessageListSession`; it must not call request APIs,
  merge data, persist anchors or run read receipts.
- Runtime and data runtime stay package-internal implementation details.

React is pinned to `18.3.1` to match the current TypeX render package.
