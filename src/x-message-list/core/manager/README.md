# MessageList Manager

`src/x-message-list/core/manager` is the application orchestration layer above
the framework-independent runtime. It owns per-conversation
`MessageListSession` instances and keeps them alive independently from React
component mount state.

## Responsibilities

- Lazily create one `MessageListSession` per conversation id.
- Resolve app-level dependencies through `getConversation` and `getAdapter`.
- Own viewport runtime, data runtime, request bridge, `anchorMemory` and
  `readReceipts` workers for each session.
- Apply request tokens, stale-response guards, segment merge, trim and failure
  acknowledgement before publishing loaded segments to the viewport runtime.
- Expose a thin public session with `commands` and `rows`; runtime internals stay
  package-internal.

## Public Shape

Applications create one manager at app level:

```ts
const manager = createMessageListManager({
  defaults: {
    pageSize: 30,
    maxItems: 300,
    keepAlive: {
      maxSessions: 20,
      ttlMs: 10 * 60_000,
    },
  },
  getConversation: (id) => ({ id }),
  getAdapter: (conversation) => normalMessageAdapter,
})
```

`MessageList` unmount detaches DOM refs only. It does not destroy the session;
manager retention or explicit `destroySession(id)` owns destruction.
