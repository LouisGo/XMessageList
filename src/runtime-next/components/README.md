# runtime-next components

本目录承载 runtime-next 自己的 React projection adapter。它不是 `src/react`
的移动版，也不是 deprecated adapter 的兼容层。

P1 阶段只允许本 README。后续实现必须从 runtime-next 合同开始重写：

- 组件、hook、custom scrollbar 都归属 runtime-next。
- 禁止 import `src/react` 或 `src/runtime.deprecated`。
- React 只做 projection、ref 注册、commit ack 和 pointer event 转发。
- React 不能选择 render rows、spacer、bottom lock、anchor recovery 或 physical metrics。
- 单个 React component / adapter 文件不得超过 500 行。
- 复杂类型必须拆到 co-located `*.types.ts`。
- 关键 ownership、commit ack 时序和 geometry invariant 处写精准中文注释。

