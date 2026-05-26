# Next 重写实施路线

本文档描述 next 分支从文档到实现的阶段顺序。当前方向是：`src/runtime/` 与 `src/react/` 作为旧实现整体删除后重写，不做渐进迁移，不保留 deprecated runtime，不从旧目录搬运实现细节。

## 进度规则

- [x] 每个 phase 的任务和退出标准都用 markdown checkbox 追踪。
- [x] 只有完成实现、文档同步和验证证据后，才能把对应 checkbox 改成 `[x]`。
- [x] 每个 phase 结束都更新本文档状态，并用退出标准决定能否进入下一 phase。

## 重写边界

必须删除后重建：

- `src/runtime/` 下旧 runtime、window/spacer、transaction、scroll motion、diagnostics、tests。
- `src/react/` 下旧 adapter、projection、custom scrollbar、hooks、tests。
- 所有以 renderWindow、top/bottom spacer、virtual range、legacy viewport effect 为正向模型的实现和测试。

可以保留并改接：

- demo / e2e 中有产品含义的请求形态，例如 `getLatestMessages`、`getMessagesAround`、before / after / latest / around 查询语义。
- demo seed、mock stream、bot push、event storm、e2e evidence/oracle 思路。
- 这些保留项只能模拟 host / bridge / BFF，不得接管 runtime 的 scroll、measurement、anchor correction 或 pagination latch。

全程硬约束：

- `scrollHeight` 只来自当前 loaded segment 的真实 DOM。
- data runtime 发布 immutable segment；viewport runtime 消费 modifier、测量 DOM、修正滚动；React adapter 只投影和 ack。
- 外部库经验只能翻译成合同、diagnostics 或 oracle，不能引入第二套 scroll truth。

## Phase 0 文档冻结

依赖：无。

目标：

- [x] 确认 architecture / interaction / implementation / testing 文档都以 loaded segment native scroll 为唯一正向机制。
- [x] 冻结术语与 public API 命名，统一采用 `MessageList` / `MessageListRuntime` / `MessageListSnapshot` 口径。
- [x] 明确 `src/runtime/` 和 `src/react/` 是 rewrite targets，不是 migration sources。
- [x] 明确保留 demo / e2e 请求模型的边界。

任务：

- [x] 复核 projection snapshot / evidence shape 是否包含 hasMoreBefore/After、modifier、generation、revision/token、bottomLockState、pendingIntent。
- [x] 复核 [architecture/naming-and-api.md](./architecture/naming-and-api.md) 是否覆盖组件名、hooks、runtime facade、adapter-private API、events、main 分支 API 对照和禁止词。
- [x] 复核 short segment underflow、identity-remap、local-to-server remap、destination restore、bottom follow 的合同和 oracle。
- [x] 在 roadmap 中锁定删除旧实现的 phase gate。

退出标准：

- [x] 文档中不存在把 spacer、global estimated range、renderWindow 作为正向机制的描述。
- [x] 所有 public API 文档使用 `MessageList` 口径；`MessageViewport*` 只作为迁移对照或删除清单出现。
- [x] roadmap 明确禁止保留 `src/runtime/`、`src/react/` 旧实现。
- [x] demo / e2e 保留项只限请求形态、mock data、evidence/oracle，不含 runtime ownership。

验证证据（2026-05-26）：

- `docs/README.md`、`docs/architecture/naming-and-api.md`、`docs/architecture/layering-and-ownership.md`、`docs/architecture/anchor-and-data-window.md`、`docs/implementation/dom-layout.md`、`docs/implementation/react-adapter.md`、`docs/testing/oracles.md` 已复核。
- `rg "MessageViewport|MessageViewportRuntime|MessageViewportSnapshot|renderWindow|topSpacer|bottomSpacer|spacerEngine|virtual range|virtualRange|estimatedTotalHeight|globalOffset|viewportEffect|dispatch\\(\\{ type|registerTopSpacer|registerBottomSpacer|registerTopSentinel|registerBottomSentinel|DataWindow|RenderWindow" docs --glob '!docs/research/virtual-list-ecosystem-research.md'` 的命中均为迁移对照、删除清单或禁止事项；implementation README 已改为从零建立 loaded segment projection snapshot。
- 删除旧实现的 phase gate：Phase 1 不允许保留、搬运或兼容 `src/runtime/` / `src/react/` 旧实现；Phase 1 退出前必须证明旧 public surface 与 spacer/renderWindow/viewportEffect 正向路径已消失。

## Phase 1 Legacy Removal And Empty Shell

依赖：Phase 0。

目标：

- [x] 一次性删除旧 `src/runtime/` 和 `src/react/` 实现。
- [x] 建立全新的、最小可编译合同骨架。

Phase gate：Phase 1 必须把 `src/runtime/` 与 `src/react/` 旧实现整体删除后重建；禁止保留、搬运、兼容旧 runtime，也禁止用 demo/e2e 代码接管 scroll、measurement、transaction 或 anchor correction。

任务：

- [x] 删除旧 runtime/react 源码和旧单测，尤其是 spacer、renderWindow、height range、virtual scrollbar travel、legacy viewportEffect 相关路径。
- [x] 重建 `src/runtime/` 的 contract-only skeleton：identity、loaded segment、modifier、`MessageListSnapshot`、events、diagnostics、runtime options。
- [x] 重建 `src/react/` 的 adapter skeleton：`MessageList` component type、slot type、commit ack type、style boundary，不实现旧 DOM。
- [x] 更新根入口和 package export，使旧 API 不能被新代码误引用。
- [x] 保留 demo/e2e request API 文件，但断开它们对旧 runtime/react 具体实现的依赖。

退出标准：

- [x] `src/runtime/` 和 `src/react/` 中没有旧文件、旧测试或从旧实现复制来的模块。
- [x] `rg "renderWindow|topSpacer|bottomSpacer|spacerEngine|viewportEffect|virtual range" src/runtime src/react` 无正向实现命中。
- [x] 类型层只暴露 next contracts；旧字段无法被新代码引用。
- [x] package 根出口不再暴露 `MessageViewport`、`MessageViewportRuntime`、`MessageViewportSnapshot`、`dispatch({ type })` 这类旧 public surface。
- [x] repo 至少能完成 contract skeleton 的 typecheck/lint；若 demo 暂未接入，失败必须只指向后续明确 phase 的未实现入口。

验证证据（2026-05-26）：

- `src/runtime/` 与 `src/react/` 已删除旧实现后重建；旧 runtime/react 单测和旧 spacer/renderWindow/custom scrollbar 实现已移除。
- `rg "renderWindow|topSpacer|bottomSpacer|spacerEngine|viewportEffect|virtual range" src/runtime src/react` 无命中。
- `rg "MessageViewport|MessageViewportRuntime|MessageViewportSnapshot|dispatch\\(\\{ type\\}|setDataSnapshot" src/runtime src/react src/index.ts` 无命中。
- `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build`、`git diff --check` 通过。
- demo/e2e request API 保留为 `getLatestMessages` / `getMessagesAround`，demo/e2e shell 仅响应 semantic runtime surface；旧 e2e runner 场景等待 Phase 7 重新接线。

## Phase 2 Data Runtime Contract

依赖：Phase 1。

目标：

- [x] 从零实现 Renderer Data Runtime 的纯数据层合同。
- [x] 保持 demo/e2e 的请求方式不变，但返回值适配 next loaded segment。

任务：

- [x] 实现 `MessageIdentity`、`MessageRuntimeItemKey`、`MessageDataItem`、`LoadedSegment`、`SegmentModifier`。
- [x] 实现 before / after merge、reset-latest、reset-around、patch、identity-remap、trim decision 的纯数据逻辑。
- [x] 实现 requestToken、generation、segmentRevision、dedupe、stale response drop。
- [x] 把 demo/e2e 的 `getLatestMessages`、`getMessagesAround` 接到 data runtime adapter，不让 demo 读写 DOM 或 scrollTop。
- [x] 建立 data runtime 单元测试，覆盖 optimistic id -> server id、deleted / unavailable fallback、duplicate server message、segment trim policy。

退出标准：

- [x] data runtime 不依赖 DOM、React、scroll metrics。
- [x] 所有 item merge / trim / remap 都由 data runtime 产出 immutable next segment。
- [x] demo/e2e mock request shape 保持稳定。
- [x] 单元测试证明 data modifier 分类正确。

验证证据（2026-05-26）：

- 新增 `src/runtime/data/`，data runtime 覆盖 reset-latest、reset-around、extend-before/after、patch、identity-remap、trim、request token、generation 和 stale response drop。
- demo/e2e shell 保留 `getLatestMessages` / `getMessagesAround` 请求形态，响应结果先进入 `createMessageListDataRuntime()`，再由 data runtime 的 immutable `LoadedSegment` 交给 viewport runtime。
- `rg "document|HTMLElement|scrollTop|scrollHeight|clientHeight|React|from 'react'|from \"react\"" src/runtime/data` 无命中。
- `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build`、`git diff --check` 通过；`src/runtime/data/__tests__/dataRuntime.test.ts` 覆盖 optimistic id -> server id、deleted fallback、duplicate server message、trim/stale response。

## Phase 3 Viewport Runtime Kernel

依赖：Phase 2。

目标：

- [x] 从零实现不依赖 React 的 viewport kernel。
- [x] 建立 projection transaction、measurement、correction 的基座。

任务：

- [x] 实现 DOM registry：scroll container、message flow、edge triggers、bottom marker、row key -> HTMLElement。
- [x] 实现 projection transaction queue：capture anchor -> publish snapshot -> wait commit ack -> measure -> correct -> settle。
- [x] 实现 visual anchor、bottom anchor、scroll source、commit timeout、stale generation drop。
- [x] 实现 ResizeObserver dirty batching 和 measurement cache 边界。
- [x] 实现 diagnostics ring buffer 和 stable evidence hooks。

退出标准：

- [x] viewport runtime 不创建、合并、删除、去重或重排 items。
- [x] commit ack 前不能读取新 row rect 或发布 committed measurement。
- [x] recovery/programmatic correction 不触发 edge need。
- [x] targeted kernel tests 覆盖 anchor preservation、commit ack gate、resize stabilization、stale generation。

验证证据（2026-05-26）：

- 新增 viewport kernel：`RuntimeDomRegistry`、projection transaction ack gate、visual anchor correction、commit timeout、stale generation drop、ResizeObserver dirty batching、diagnostics ring buffer 与 `ViewportEvidence`。
- `src/runtime/__tests__/viewportKernel.test.ts` 覆盖 commit ack 前不 settle、anchor correction、stale generation drop、commit timeout、loaded DOM evidence、resize dirty batching。
- `rg "dedupe|mergeBefore|mergeAfter|sort\\(|splice\\(|messagesAround| getLatestMessages|getMessagesAround" src/runtime/controller.ts src/runtime/domRegistry.ts src/runtime/measurement.ts` 无命中，viewport kernel 不接管 data merge/reorder。
- `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build`、`git diff --check` 通过。

## Phase 4 React Adapter Rebuild

依赖：Phase 3。

目标：

- [x] 从零实现 React projection adapter。
- [x] React 只投影 snapshot、注册 refs、发送 commit ack、渲染 slots。

任务：

- [x] 实现 external store hook，保证 snapshot object 稳定，避免 React state 拆分 segment / edge / phase。
- [x] 实现固定 DOM skeleton：before trigger + rows + after trigger + bottom marker。
- [x] 实现 row wrapper：runtime key、row kind、identity data attributes、ref register/unregister。
- [x] 实现 layout effect commit ack：调用 `ackProjectionCommit(commitToken)`，ack 必须带 feedId / generation / segmentRevision / projectionRevision。
- [x] 实现 slots：`renderBeforeEdge`、`renderAfterEdge`、`renderScrollToLatest`、`renderOverlay`。

退出标准：

- [x] React adapter 不读写 `scrollTop`。
- [x] React adapter 不维护 edge latch、bottom lock、anchor persistence。
- [x] DOM 中不存在 spacer 或 estimated total height。
- [x] StrictMode attach / detach / attach 不泄漏 refs 或 observers。

验证证据（2026-05-26）：

- 新增 `MessageFlow`、`MessageRow`、`ProjectionCommitAck`，`MessageList` 通过 `useSyncExternalStore` 读取 runtime snapshot，渲染固定 DOM skeleton、注册 refs，并在 layout effect 中 ack 完整 `ProjectionCommitToken`。
- `src/react/__tests__/messageListAdapter.test.tsx` 覆盖 fixed DOM skeleton、before/after/bottom marker、row data attributes、slots、layout-effect ack、StrictMode idempotent ack、runtime semantic scroll-to-latest command、无 spacer DOM。
- `rg "scrollTop|scrollHeight|clientHeight|spacer|estimated total|estimatedTotalHeight|edge latch|bottom lock|anchor persistence" src/react --glob '!**/__tests__/**'` 无命中，React adapter 未接管 scroll/measurement/latch/anchor ownership。
- `npm run typecheck`、`npm run lint`、`npm run test`、`npm run build`、`git diff --check` 通过。

复核修复证据（2026-05-26）：

- Phase 4 no-go 复核后补齐 runtime transaction 串行队列、generation 取消 active/queued older transaction、token-scoped commit timeout、settle/timeout event 重入队列保护、identity-remap anchor key 解析、`viewportAnchorChanged(transaction-settle|detach)`、`viewportObservationChanged` 与 `viewportError(code: 'commit-timeout')`。
- 补齐 `MessageList` public callback 合同，`onViewportAnchorChange(event)` / `onViewportObservationChange(event)` 只转发 runtime 事件；React 仍只 projection + refs + ack。
- demo CSS 已把 `[data-message-scroll-container]` 落为唯一 native scroll root，并由 `[data-message-flow]` 负责 short alignment；移除旧 `[data-message-window]` 布局 selector。
- `src/runtime/__tests__/viewportKernel.test.ts` 覆盖 active transaction FIFO、generation cancellation、event-triggered publish 重入、commit timeout event、timeout 后队列推进、identity-remap anchor correction、settle checkpoint、detach 前 capture 当前可视 anchor、detach DOM refs / ResizeObserver cleanup 与 observation。
- `src/react/__tests__/messageListAdapter.test.tsx` 覆盖 public viewport callbacks 能收到 runtime settle observation/anchor event。
- `npm run test -- src/runtime/__tests__/viewportKernel.test.ts`、`npm run test -- src/react/__tests__/messageListAdapter.test.tsx`、`git diff --check`、`npm run typecheck`、`npm run lint`、`npm run test`、`npm run build`、`npm run build:demo` 通过。

## Phase 5 Interaction State Machines

依赖：Phase 4。

目标：

- [ ] 补齐用户可见交互语义。
- [ ] 把 edge、destination、bottom follow、underflow 都接入统一 pending intent。

任务：

- [ ] 实现 before / after edge paging、request latch、paging error retry。
- [ ] 实现 short segment underflow fill 仲裁，一轮只允许一个 edge request。
- [ ] 实现 bottom follow：partial segment 走 latest reset，latest locked 后 append / streaming 保持底部。
- [ ] 实现 jump / restore：in-segment local align，outside-segment needMessagesAround + reset-around。
- [ ] 实现 feed switch detach checkpoint、per-feed runtime cache、generation guard。
- [ ] 实现 dynamic height stabilization：above-anchor growth、current-row streaming、container resize。

退出标准：

- [ ] follow bottom 不把 partial after edge 当 latest。
- [ ] restore 不复用旧 `scrollTop`。
- [ ] underflow fill 不制造双边请求风暴。
- [ ] dynamic height 不通过 reset 掩盖 measurement 问题。
- [ ] targeted interaction tests 覆盖 edge latch、underflow、bottom lock、destination、feed switch。

## Phase 6 Scrollbar And Observability

依赖：Phase 5。

目标：

- [ ] custom scrollbar overlay 只镜像 native metrics。
- [ ] 性能和诊断可以解释所有 correction。

任务：

- [ ] 实现 native mirror overlay：thumb length / position 来自 scrollTop、clientHeight、scrollHeight。
- [ ] 实现 drag / track click direct scroll API，写入仍由 viewport runtime scroll writer 统一管理。
- [ ] 实现 measurement cache diagnostics、blank-area sample、frame-gap sample、transaction latency、correction delta。
- [ ] 建立 overlay metric mismatch warning。

退出标准：

- [ ] overlay 不读取 edge state 来改变 track。
- [ ] overlay 不拥有 paging、bottom lock、trim、anchor correction。
- [ ] before / after data load 后 thumb 自然离开边缘。
- [ ] diagnostics 能解释 measurement cache hit/miss/invalidate 和每次 correction。

## Phase 7 Demo And E2E Rewire

依赖：Phase 6。

目标：

- [ ] 把保留的 demo/e2e mock request 合同接入新 runtime。
- [ ] 重建真实浏览器证据矩阵。

任务：

- [ ] demo 通过 runtime events 响应 `needMoreBefore`、`needMoreAfter`、`needLatestMessages`、`needMessagesAround`。
- [ ] 保留 `getLatestMessages`、`getMessagesAround` 的请求语义和 e2e store 测试，更新返回数据到 next segment contract。
- [ ] 更新 e2e evidence shape：无 spacer 字段，包含 segment boundary、modifier、generation/revision/token、identity、pendingIntent。
- [ ] 重建 testing 文档中的 P0-P4 场景。
- [ ] long-running mock event storm / bot push 保持 start/stop 语义，不阻塞 idle oracle。

退出标准：

- [ ] testing 文档中的 P0-P4 场景真实浏览器通过。
- [ ] correctness lane 与 perf lane 分开。
- [ ] 失败截图、event log、diagnostics 足以定位 data / viewport / React / demo owner。
- [ ] `npm run build:demo` 使用新 adapter 和 runtime。

## Phase 8 Hardening And Public Boundary

依赖：Phase 7。

目标：

- [ ] 清理重写后的包边界和长期维护风险。

任务：

- [ ] 收紧 public exports，避免暴露 internal transaction / DOM registry。
- [ ] 加 import guards：React adapter 不得导入 data merge internals；demo/e2e 不得导入 viewport private objects。
- [ ] 建立 no-god-file 检查和 co-located domain organization。
- [ ] 补齐 README / migration note，说明旧 `src/runtime/`、`src/react/` 已被删除重写。
- [ ] 运行完整验证 bundle。

退出标准：

- [ ] `git diff --check`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run build:demo`
- [ ] real-browser e2e correctness lane 通过，perf lane 有独立报告。
