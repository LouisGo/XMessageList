# XMessageList

Deterministic IM message-list runtime for TypeX-style chat surfaces. It is not a generic virtual list: the current loaded segment is rendered in normal document flow, while the runtime owns native scroll semantics, visual-anchor correction, DOM measurement, edge requests, diagnostics, and evidence.

React is only the projection adapter. Host/data code merges messages into immutable `LoadedSegment` snapshots, publishes them to the runtime, and responds to semantic need events.

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

## Runtime Boundary

- `src/runtime`: framework-independent viewport runtime. It consumes already-merged `LoadedSegment` data, serializes projection transactions, owns DOM refs/measurement, writes `scrollTop`, preserves visual anchors, emits need events, and reports diagnostics/evidence.
- `src/runtime/data`: demo/test data runtime. It owns merge, dedupe, identity remap, trim, request-token, and generation/stale-response rules before publishing immutable segments.
- `src/react`: React 18 `MessageList` adapter. It subscribes with `useSyncExternalStore`, renders rows/triggers/optional overlay, registers refs, attaches the native scroll container, and acks projection commits in layout effects.
- `src/demo`: local mock host and scenario wiring for feeds, edge requests, dynamic height, optimistic remap, event storms, and bot push.
- `src/e2e-app` and `e2e/runner`: real-browser bridge, evidence, oracle, correctness, and perf lanes.
- `docs`: architecture, interaction specs, implementation constraints, testing contracts, and migration notes.

## Minimal Usage

```tsx
import {
  MessageList,
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
} from 'x-message-list'

const runtime = createMessageListRuntime<MyMessage>({ feedId: 'feed-1' })

runtime.applyLoadedSegment({
  feedId: 'feed-1',
  generation: 1,
  segmentRevision: 1,
  items,
  hasMoreBefore: true,
  hasMoreAfter: false,
  modifier: { type: 'reset-latest' },
} satisfies LoadedSegment<MyMessage>)

runtime.subscribeRuntimeEvent((event) => {
  if (event.type === 'needMoreBefore') {
    loadOlderMessages(event.requestToken)
  }
})

export function Chat() {
  return (
    <MessageList
      runtime={runtime}
      renderRow={(item: MessageDataItem<MyMessage>) => (
        item.message ? <MessageRow message={item.message} /> : null
      )}
    />
  )
}
```

## Public Contracts

- Package root exports `MessageList`, hooks, `createMessageListRuntime`, and message-list/runtime/data contract types only. Internal controller, DOM registry, measurement, transaction, projection ack, and data merge internals are not public package API.
- `MessageListRuntime` is a feed-scoped facade. Hosts publish data with `applyLoadedSegment(...)`, navigate with `scrollToLatest(...)`, `scrollToMessage(...)`, and `restoreToMessage(...)`, then react to semantic runtime events.
- `MessageListSnapshot` contains loaded-segment projection state, edge state, bottom-lock state, pending intent, viewport phase, revision counters, and commit token. It does not contain render windows, spacers, estimated total height, global offsets, or raw persisted `scrollTop`.
- DOM refs are registered by React but owned by the runtime. Ref callbacks must not measure, dispatch, or mutate scroll position.
- `ResizeObserver` and `IntersectionObserver` are signals only. Runtime batches measurement/correction and arbitrates edge requests.

React is pinned to `18.3.1` to match the current TypeX render package.
