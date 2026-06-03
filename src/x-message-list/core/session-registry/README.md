# MessageList Session Registry

`src/x-message-list/core/session-registry` is the application orchestration layer above
the framework-independent runtime. It owns per-session/feed
`MessageListSession` instances and keeps them alive independently from React
component mount state.

## Responsibilities

- Lazily create one `MessageListSession` per session/feed id.
- Resolve app-level dependencies through `getFeed` and `getAdapter`.
- Own the current session loaded segment, viewport state, edge state, request
  bridge, `anchorMemory` and `readReceipts` workers.
- Apply request tokens, stale-response guards, segment merge, trim and failure
  acknowledgement before publishing loaded segments to the viewport runtime.
- Expose a thin public session with `getState`, `subscribe`, `commands`,
  `tail.local`, `tail.remote` and `rows`; runtime internals stay
  package-internal.
- Keep application pagination caches, persistence and dirty timestamp checks in
  the host store. `rows.mutate` is loaded-only by design.

## Public Shape

Applications create one registry at app level:

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

`MessageList` unmount detaches DOM refs only. It does not destroy the session;
registry retention or explicit `destroySession(sessionId)` owns destruction.
