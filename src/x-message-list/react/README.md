# React 适配器

`src/x-message-list/react` 将 `MessageListSession` 投射到 DOM，并向 runtime 报告提交确认。它不掌管数据请求、数据合并、滚动修正、边缘锁定、已读回执或锚点持久化。

## 目录规则

- `components/`：投射外壳、行、提交确认、provider context 和 runtime 事件桥接。
- `hooks/`：provider 支撑的 React 集成，如 `useMessageListSession` 和基于 selector 的 session 状态读取 `useMessageListState`；adapter-private hook primitives 用于稳定 callback、external store 订阅、RAF 和 timer 生命周期。
- `scrollbar/`：可选的自定义滚动条浮层、度量读取、几何与样式。
- `types.ts` 和 `index.ts`：React 适配器的公开接口面。

React 可使用 runtime 的公开/适配器私有 barrel 和 manager 内部 session 访问，但适配器组件不得导入 runtime 私有实现文件。

## Hook 范式

- 对 runtime/session store 使用 `useSyncExternalStore` 范式；组件不把 runtime snapshot、DOM evidence 或连续 scroll metrics 镜像成业务 React state。
- 外部订阅、DOM listener、runtime event bridge 使用稳定 callback 读取最新 props，避免 props 变化导致重复订阅。
- RAF、timer 和 listener cleanup 通过 adapter-private hook primitives 管理；scroll/drag 热路径仍直接写 DOM 或 runtime direct-scroll API。
- debounce/throttle 不作为 adapter 默认抽象；只有真实低频业务输入需要时才引入。scrollbar refresh 采用 RAF 合批。
- adapter-private hooks 不从 package root 导出，不构成业务接入 API。

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
