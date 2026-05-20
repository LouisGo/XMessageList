# XMessageList

独立的 IM message viewport runtime 原型。它不是通用 virtual list，而是面向聊天消息流的 deterministic viewport runtime：消息 row 保持正常文档流，runtime 拥有滚动语义、锚点稳定、DOM measurement 和 transaction，React 只做 projection。

当前仓库已切换到 runtime-next 重写路线。旧 runtime 已隔离为 `src/runtime.deprecated`，只作为行为参考；新的 Physical Segment Windowing runtime 将从 `src/runtime-next` 增量实现。

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
- `src/runtime.deprecated`: deprecated runtime baseline。当前 demo 仍依赖它运行，但新架构不再在这里实现。
- `src/runtime-next`: P1 结构占位。当前只包含 README、components README、导出占位和类型骨架；后续在自身 `components/` 内完全重写 React projection adapter。Physical geometry layer 后续唯一拥有 render rows、local spacers、`physicalWindowHeight`、`segmentRevision` 和 physical metrics。
- `src/react`: deprecated React 18 projection adapter，与 `src/runtime.deprecated` 一起冻结。当前 demo 仍依赖它运行，但 runtime-next 不能 import 或复用这里的组件、hook、custom scrollbar。
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

- runtime-next real geometry / paging / measurement / motion / scrollbar
- real SDK / Bridge / data runtime
- full unread/restored/jump state machines
- identity rebind and delete fallback
- sticky secondary anchors
- browser integration tests

React 版本固定为 `18.3.1`，与 `typex-pc` 当前 render 包保持一致。
