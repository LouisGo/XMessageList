# Runtime

`src/runtime` 是 framework-independent 的 IM message viewport runtime。它负责滚动容器的命令、事务、测量、anchor、window、spacer、scroll motion 和 projection snapshot，不负责渲染具体消息 UI。

## 目录原则

根目录只保留 public surface 和维护入口：

- `MessageViewportRuntime.ts`：稳定 public facade，只转发到 controller。
- `types.ts`：外部可见的 runtime 类型和合同。
- `index.ts`：包导出入口。
- `README.md`：当前目录维护说明。
- `__tests__/`：runtime 行为回归测试。

实现代码直接放在语义明确的一级目录下，不再增加 `internal/` 之类的空层级。新增文件时优先放进现有目录；只有出现稳定的新职责边界时，才新增一级目录。

## 职责边界

Runtime 拥有：

- container attach / detach / destroy 生命周期
- DOM row、spacer、sentinel ref registry
- RenderWindow 和 spacer 计算
- commit 后同步测量和 ResizeObserver dirty batching
- viewport anchor 捕获、restore、fallback
- prepend / append / jump / restore / follow-bottom / resize 等事务
- scrollTop 写入、scroll source 分类、bottom lock、bounded motion
- projection snapshot 发布和 revision 管理
- `needMoreBefore` / `needMoreAfter` / `needLatestMessages` /
  `needMessagesAround` / `viewportAnchorChanged` 等 runtime event
- 可选 debug diagnostics，用于记录 lifecycle / data / transaction / projection /
  scroll / measurement / motion / recovery 等决策现场；默认关闭，不参与滚动语义

Runtime 不拥有：

- React component tree 和消息 JSX
- SDK / BFF 请求
- 业务权限、消息转换、feed 数据缓存
- demo 的分页策略、调试按钮、日志 UI

React 只能订阅 projection、注册 DOM ref、在 commit 后回传 `ProjectionCommit`，并把 UI 操作翻译成 runtime command。React 不应直接实现滚动修正、window 裁剪或测量策略。

## 模块划分

### `core/`

Runtime 的生命周期、协调器接线和 projection 边界。

- `MessageViewportRuntimeController.ts`：imperative engine 主控，负责命令路由、coordinator wiring、状态机和调度入口。
- `projectionStore.ts`：外部 store，供 React `useSyncExternalStore` 订阅。
- `projectionCoordinator.ts`：发布 projection snapshot，计算 spacer、edge state 和 revision equality。
- `commitCoordinator.ts`：等待 React commit ack，处理 timeout / cancel。
- `lifecycleGuard.ts`：用 feedId + generation 丢弃过期异步工作。
- `runtimeTypes.ts`：仅供 runtime 内部共享的派生类型和常量。

### `debug/`

Runtime 内部观测能力。

- `diagnosticRecorder.ts`：channel / severity 过滤、lazy details、ring buffer 和
  `viewportDiagnostic` event 输出。关闭或过滤命中失败时不构造 details。

### `transactions/`

所有会改变 DOM window、spacer 或 scrollTop 的事务都在这里执行，并由 `TransactionRunner` 串行化。

- `transactionRunner.ts`：事务队列和 supersede 管理。
- `viewportTransactionController.ts`：prepend、append、jump、restore、follow-bottom、projection refresh、window slide、container resize、reset。
- `bootstrapTransactions.ts`：latest / restored bootstrap 的独立事务流程。

### `dom/`

DOM 注册、测量和视觉 anchor。

- `domRegistry.ts`：container、row、spacer、sentinel refs。
- `anchorCoordinator.ts`：viewport anchor 捕获、identity anchor 转 restore target、DOM fallback row。
- `measurementEngine.ts`：mounted row 同步测量、height cache 写入、ResizeObserver dirty height flush。

### `window/`

当前 `MessageDataSnapshot.items` 内的 projection window 和 spacer 估算。

- `renderWindowEngine.ts`：围绕 latest 或当前 anchor 计算 mounted item range。
- `spacerEngine.ts`：用实测高度、估算高度和默认高度计算 top/bottom spacer。

### `scroll/`

滚动意图、目标滚动和动画。

- `scrollIntentEngine.ts`：区分用户滚动和 runtime 写入，维护 bottom lock hysteresis。
- `destinationMotionCoordinator.ts`：follow-bottom / jump motion 的 settle、cancel 和最终 projection 状态。
- `scrollMotionEngine.ts`：纯 animated scrollTop writer，不读 row DOM、不发布 projection。

### `events/`

Runtime event 的边界触发。

- `edgeNeedCoordinator.ts`：top/bottom edge latch、sentinel observation、分页 need event。

### `shared/`

无状态工具函数。这里不能放会形成隐式 ownership 的业务逻辑。

## 关键不变量

- `MessageViewportRuntime.ts` 必须保持 facade 形态，不能重新堆积实现逻辑。
- Runtime 代码不能 import React；React adapter 代码必须留在 `src/react`。
- 所有 DOM 读取必须发生在 projection commit 之后。需要读 row DOM 的事务必须等待 `ProjectionCommit`。
- `ProjectionCommit` 必须按 `feedId + generation + revision` 精确匹配，旧 commit ack 不能唤醒新事务。
- `feedId + generation` 是异步工作隔离边界。generation 变化时必须清理 transaction、commit wait、height cache、edge latch 和 pending motion。
- 派生 index / spacer range / projection slice cache 只能按 data revision 复用，不能把 `items` 数组引用相等当作数据身份未变化。
- `AnchorState` 是 renderer runtime 内部视觉 anchor，包含 DOM layout offset；跨层合同只能使用 `MessageIdentityAnchor`。
- `bottomLockState: LOCKED` 只表示已经到达 feed latest。`hasMoreAfter=true` 时，当前物理底部只是已加载 DataWindow 的 after edge。
- runtime 写入 `scrollTop` 必须通过 scroll intent 标记来源，不能让 recovery / follow-bottom 写入被误判成用户滚动。
- `TransactionRunner` 必须串行化 viewport mutation；prepend、append、jump、resize 等事务不能并发读取和修正同一批 DOM。
- RenderWindow 的 `startIndex/endIndex` 只是当前 `MessageDataSnapshot.items` 内的临时派生值，不能作为持久 restore anchor。
- Spacer 是连续感估算，不是全局精确坐标系统。真实稳定性来自 commit 后测量和 anchor 差值补偿。

## 维护规则

新增行为前先判断归属：

- 改滚动语义、测量、window、anchor、事务：放在 `src/runtime`。
- 改 projection DOM 结构、slot、loading/follow-bottom UI：放在 `src/react`。
- 改数据请求、分页策略、feed 切换策略：放在 data/demo/adapter 层，不要塞进 runtime。

新增注释只写在容易误改的时序、边界或不变量上。不要给显而易见的赋值、guard、getter 补说明。

## 验证

Runtime 相关改动至少运行：

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

针对 scroll motion 或 transaction 时序的改动，还应优先补充 `src/runtime/__tests__/` 下的回归测试。
