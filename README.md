# XMessageList

独立的 IM message viewport runtime 原型。它不是通用 virtual list，而是面向聊天消息流的 deterministic viewport runtime：消息 row 保持正常文档流，runtime 拥有滚动语义、锚点稳定、DOM measurement 和 transaction，React 只做 projection。

当前仓库已切换到 runtime-next 重写路线。现有 `src/runtime` 是旧 runtime 基线，后续需要改名为 `src/runtime.deprecated` 并只作为行为参考；新的 Physical Segment Windowing runtime 将进入 `src/runtime-next`。

## Commands

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

## Runtime Boundary

- `src/runtime`: deprecated runtime baseline。当前 demo 仍可依赖它运行，但新架构不再在这里实现。
- `src/runtime.deprecated`: 后续目标名称。只保留备份和必要行为参考。
- `src/runtime-next`: 后续新建的 runtime-next 承载体。Physical geometry layer 唯一拥有 render rows、local spacers、`physicalWindowHeight`、`segmentRevision` 和 physical metrics。
- `src/react`: React 18 projection adapter。使用 `useSyncExternalStore` 订阅 runtime snapshot，通过 ref callback 注册 row/spacer/sentinel DOM，并在 layout effect 中 attach scroll container 与发送 commit ack；订阅必须先于 attach。
- `src/demo`: 本地 mock 数据和交互场景，覆盖 latest bootstrap、prepend、append、dynamic height。
- `src/test`: fake scheduler、fake observers、DOM metric helpers。
- `docs/architecture` / `docs/viewport-runtime`: 设计文档和外部 research，作为实现约束。

## Minimal Usage

```tsx
import {
  MessageViewport,
  MessageViewportRuntime,
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
- `MessageViewportSnapshot` contains only projection fields: mounted items, RenderWindow, spacer heights, bottom lock state, bootstrap state, and edge state.
- `ProjectionCommit` must match `feedId + generation + revision`; stale commit acks are ignored.
- DOM refs are registered by React but owned by runtime. Ref callbacks must not measure, dispatch, or mutate `scrollTop`.
- `ResizeObserver` is a dirty signal. Runtime coalesces height stabilization in rAF.
- `IntersectionObserver` is only an edge prefetch / visibility signal. It does not directly mutate window or scroll position.

## Current Scope

Current deprecated runtime vertical slice:

- latest bootstrap to bottom locked
- append follow-bottom when locked
- unlocked append preserving user position
- prepend anchor rect correction
- snapshot external store
- React projection adapter and StrictMode-safe attach/detach
- unit tests for runtime transaction and adapter contracts

Not implemented yet:

- runtime-next code
- `src/runtime` -> `src/runtime.deprecated` structure isolation
- real SDK / Bridge / data runtime
- full unread/restored/jump state machines
- identity rebind and delete fallback
- sticky secondary anchors
- browser integration tests

React 版本固定为 `18.3.1`，与 `typex-pc` 当前 render 包保持一致。
