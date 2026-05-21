# runtime-next components

本目录承载 runtime-next 自己的 React projection adapter。它不是 `src/react`
的移动版，也不是 deprecated adapter 的兼容层。

P6 已将默认 demo 接到 runtime-next 自有 adapter。实现必须从 runtime-next 合同开始维护：

- 组件、hook、custom scrollbar 都归属 runtime-next。
- 禁止 import `src/react` 或 `src/runtime.deprecated`。
- React 只做 projection、ref 注册、commit ack 和 pointer event 转发。
- React 不能选择 render rows、spacer、bottom lock、anchor recovery 或 physical metrics。
- `useMessageViewportRuntime` 只能订阅 projection snapshot，并在 layout effect 中原样回传完整 `ProjectionCommitToken`。
- `usePhysicalScrollMetrics` / `CustomScrollbar` 只能消费 runtime committed metrics；禁止读取 DataWindow item count 或裸 DOM `scrollHeight` 推导 thumb。
- custom scrollbar drag 到边界时继续保持 pointer capture；handoff / freeze / continuation rebase 由 runtime 控制。
- 单个 React component / adapter 文件不得超过 500 行。
- 复杂类型必须拆到 co-located `*.types.ts`。
- 关键 ownership、commit ack 时序和 geometry invariant 处写精准中文注释。
