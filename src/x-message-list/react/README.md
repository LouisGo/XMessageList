# React Adapter

`src/x-message-list/react` projects a `MessageListSession` into DOM and reports
commit acknowledgements back to runtime. It does not own data requests, data
merge, scroll correction, edge latches, read receipts or anchor persistence.

## Directory Rules

- `components/` owns the projection shell, rows, commit ack, provider context and
  runtime event bridge.
- `hooks/` owns provider-backed React integration such as
  `useMessageListSession` and selector-backed session state reads via
  `useMessageListState`.
- `scrollbar/` owns the optional custom scrollbar overlay, metric reading,
  geometry and styles.
- `types.ts` and `index.ts` remain the public React adapter surface.

React may use runtime public/adapter-private barrels and manager internal
session access. It must not import runtime private implementation files from
adapter components.

`MessageList` accepts `session` as the application integration point:

```tsx
const session = useMessageListSession<Message>(conversationId)
const loadedCount = useMessageListState(session, (state) => state.loaded.keys.length)

return (
  <MessageList
    session={session}
    renderRow={({ row }) => <MessageRow message={row} />}
  />
)
```
