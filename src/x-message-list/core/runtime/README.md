# Runtime

`src/x-message-list/core/runtime` 掌管 loaded segment 原生滚动的视口正确性。它不掌管数据获取、React 渲染、feed 选择或 demo 行为。

## 目录规则

- 根文件仅保留 `index.ts`、`internal.ts` 和本 README。
- 公开契约类型放在 `contracts/`。
- facade/controller 编排放在 `controller/`。
- 交互状态机放在 `interactions/`，共享轴/类型放在 `state/`。
- DOM ref、测量、锚点和行度量代码放在 `dom/`。
- 滚动源、底部锁定和直接滚动会话代码放在 `scroll/`。
- 诊断/evidence/事件构建放在 `events/`。
- 提交/结算/修正流程放在 `transactions/`。
- 跨域无状态辅助放在 `shared/`；其他域不得从 `controller/` 导入。

Runtime 代码不得导入 React。视口 runtime 消费不可变的 `LoadedSegment` 快照，不得合并、去重或重排业务数据项。
