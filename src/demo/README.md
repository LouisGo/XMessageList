# Demo

`src/demo` 是用于演练本包的本地宿主实现。可模拟 feed、持久化、mock 和 E2E 场景，但不得接管滚动、测量、分页锁定或锚点修正的 runtime 所有权。

## 目录规则

- `components/`：demo UI 组件。
- `data/`：feed 夹具、mock 持久化、请求适配器和消息 API 类型。
- `mocks/`：高级 mock 发布器和测试工具。
- `scenario/`：场景编排 hook、公开 session 命令、registry 适配器接线以及 E2E 专用 evidence/reset 辅助。
- `styles/`：demo 和 E2E app 共用的 CSS 入口文件。
- `utils/`：不涉及 runtime 或数据所有权的小型通用 demo 工具。

Demo 代码应使用公开的 registry/session 路径进行常规加载和行变更。E2E 辅助可读取包内部 runtime evidence，但 demo 不得通过检查投射 DOM 来修复 runtime 行为。
