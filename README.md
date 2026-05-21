# XMessageList

独立的 IM message viewport runtime 原型。它不是通用 virtual list，而是面向聊天消息流的 deterministic viewport runtime：消息 row 保持正常文档流，runtime 拥有滚动语义、锚点稳定、DOM measurement 和 transaction，React 只做 projection。

当前仓库已切换到 runtime-next。旧 runtime 已隔离为 `src/runtime.deprecated`，只作为行为参考；默认 demo 和 root package entry 现在使用 `src/runtime-next`。

## Commands

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

## Runtime Boundary

- `src/runtime`: 已移除，不再作为实现或 import 入口。
- `src/runtime.deprecated`: deprecated runtime baseline。只保留为旧行为参考和备份，新架构不再在这里实现。
- `src/runtime-next`: 当前默认 runtime。承载 geometry、transaction/data arrival、input/motion、custom scrollbar 和自有 React projection adapter。Physical geometry layer 唯一拥有 render rows、local spacers、`physicalWindowHeight`、`segmentRevision` 和 physical metrics。
- `src/react`: deprecated React 18 projection adapter，与 `src/runtime.deprecated` 一起冻结。runtime-next 不能 import 或复用这里的组件、hook、custom scrollbar。
- `src/demo`: 本地 mock 数据和交互场景，当前基于 runtime-next 运行，覆盖 latest bootstrap、prepend、append、dynamic height。
- `src/test`: fake scheduler、fake observers、DOM metric helpers。
- `docs/architecture` / `docs/viewport-runtime`: 设计文档和外部 research，作为实现约束。

## Minimal Usage

```tsx
import {
  MessageViewportRuntime,
  MessageViewport,
  type MessageDataSnapshot,
} from 'x-message-list'

const runtime = new MessageViewportRuntime<MyMessage>({
  feedId: 'feed-1',
  generation: 1,
})

runtime.setDataSnapshot(snapshot satisfies MessageDataSnapshot<MyMessage>)
runtime.dispatch({ type: 'bootstrap', mode: 'latest' })

export function Chat() {
  return (
    <MessageViewport
      runtime={runtime}
      renderMessage={(item) =>
        item.kind === 'committed' ? <MessageRow message={item.message} /> : null
      }
    />
  )
}
```

## Public Contracts

- `MessageViewportRuntime` is feed/generation scoped. `attach`, `detach`, and `destroy` are explicit lifecycle operations.
- `MessageViewportSnapshot` contains projection fields and a full `ProjectionCommitToken`.
- `ProjectionCommitToken` ack must match feed, generation, projection revision, segment id/revision, and transaction id; stale commit acks are ignored.
- DOM refs are registered by React but owned by runtime. Ref callbacks must not measure, dispatch, or mutate `scrollTop`.
- `ResizeObserver` is a dirty signal. Runtime coalesces height stabilization in rAF.
- `IntersectionObserver` is only an edge prefetch / visibility signal. It does not directly mutate window or scroll position.

## Current Scope

Current runtime-next vertical slice:

- latest bootstrap and feed/generation-scoped data snapshots
- physical segment geometry, local spacers, commit-token ack and promote
- top/bottom paging intents, pending jump/restore/followBottom data requests
- custom scrollbar drag, wheel momentum latch, bounded motion and bottom lock
- runtime-next React projection adapter with full commit-token ack
- demo/data host using `viewportModifier` and runtime-next cache isolation

Not implemented yet:

- real SDK / Bridge / data runtime
- full unread state machine and sticky secondary anchors
- user-run browser integration coverage

React 版本固定为 `18.3.1`，与 `typex-pc` 当前 render 包保持一致。
