# React 适配器

`src/x-message-list/react` 将 `MessageListSession` 投射到 DOM，并向 runtime 报告提交确认。它不掌管数据请求、数据合并、滚动修正、边缘锁定、已读回执或锚点持久化。

## 目录规则

- `components/`：投射外壳、行、提交确认、provider context 和 runtime 事件桥接。
- `hooks/`：provider 支撑的 React 集成，如 `useMessageListSession` 和基于 selector 的 session 状态读取 `useMessageListState`。
- `scrollbar/`：可选的自定义滚动条浮层、度量读取、几何与样式。
- `types.ts` 和 `index.ts`：React 适配器的公开接口面。

React 可使用 runtime 的公开/适配器私有 barrel 和 manager 内部 session 访问，但适配器组件不得导入 runtime 私有实现文件。

`MessageList` 接收 `session` 作为应用集成入口：

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
