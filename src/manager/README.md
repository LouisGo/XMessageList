# MessageList Manager

`src/manager` is the application orchestration layer above the framework
independent viewport/data runtimes. It owns per-conversation sessions and keeps
them alive independently from React component mount state.

## Responsibilities

- Lazily create one session per conversation id.
- Resolve app-level adapters by conversation.
- Own viewport runtime, data runtime, request bridge, memory restore and read
  receipt workers for each session.
- Apply request tokens, stale-response guards, segment merge, trim and failure
  acknowledgement before publishing loaded segments to the viewport runtime.
- Expose a thin stable controller for React.

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
  resolveConversation: (id) => ({ id }),
  resolveAdapter: (conversation) => normalMessageAdapter,
})
```

React resolves the session controller from provider context and passes it to
`MessageList`:

```tsx
<MessageListProvider manager={manager}>
  <ConversationView conversationId={activeId} />
</MessageListProvider>
```

```tsx
function ConversationView({ conversationId }: { conversationId: string }) {
  const controller = useMessageListController(conversationId)

  return <MessageList controller={controller} renderRow={({ row }) => row.text} />
}
```

Unmounting `MessageList` detaches DOM refs only. It does not destroy the session;
manager retention or explicit `destroySession(id)` owns destruction.
