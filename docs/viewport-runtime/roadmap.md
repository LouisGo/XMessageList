# runtime-next 重构路线图

本文是新的执行路线。它覆盖旧的 Phase 1 / Phase 2 口径，不再把 Physical Segment Windowing graft 到现有 `src/runtime` 上。

## 当前结论

- 当前代码基线：以 Git HEAD 为准；路线图不再硬编码短 hash，避免进度记录漂移。
- 旧 runtime：已隔离到 `src/runtime.deprecated`，只作为行为备份和必要参考。
- 新 runtime：`src/runtime-next` 已补齐 P2 合同骨架，包含 public facade、projection / metrics / diagnostics / command / data 合同和 guard tests。
- 当前阶段：`P3 physical geometry kernel` 纯逻辑模块已落地；facade / transaction / data arrival 接线仍等待 P4。

## 总原则

runtime-next 从第一天起锁死几何所有权：

```text
Data runtime owns message availability.
Command layer owns semantic intent.
React adapter owns projection rendering.
Physical geometry layer owns every geometry fact.
```

只有 physical geometry layer 可以决定或发布：

- render rows
- local top/bottom spacers
- `physicalWindowHeight`
- `segmentRevision`
- `PhysicalScrollMetrics`
- safe scroll range / row coverage / cap mode
- segment shift / segment relayout 的几何结果

其他层只能提交 intent、data snapshot、DOM commit ack 或 measurement fact。它们不能直接改 geometry。

## 禁止项

以下规则跨所有阶段生效。任何实现违反其中一条，必须停止并回到架构文档。

- 禁止继续在旧 `src/runtime` 上 graft 新架构。
- 禁止为了兼容旧 runtime 保留 DataWindow -> global spacer -> native `scrollHeight` 的几何链路。
- 禁止让业务 command、data arrival、React adapter、demo 或 custom scrollbar 直接决定 render window、spacer、`physicalWindowHeight`、`segmentRevision` 或 physical metrics。
- 禁止把 `prepend` / `append` 当成 viewport transaction kind。
- 禁止用 DataWindow item count、loaded range 长度或 raw DOM `scrollHeight` 推导 thumb geometry、bottom lock、paging trigger 或 anchor recovery。
- 禁止在 React state 中维护高频 physical metrics。
- 禁止把旧 runtime 的 projection inheritance、window slide、anchor correction 逻辑迁入 runtime-next，除非先重新归类为 geometry layer 内部规则并通过 review。
- 禁止在没有 diagnostics 的情况下放行 geometry invariant 违约。
- 禁止 god file：纯逻辑文件超过 300 行、核心 class / React / adapter 文件超过 500 行时，必须拆分。
- 禁止把大块 TypeScript 类型堆在核心实现文件里；类型内容明显膨胀时必须拆到 co-located type 文件。
- 禁止把同一领域行为散落到互不相干的目录；优先 co-located，保持 high cohesion / low coupling。
- 禁止用低价值注释填充代码；关键 ownership、时序和 invariant 必须有精准中文注释。

## 依赖顺序

```text
P0 文档和边界重建
  -> P1 仓库结构隔离
    -> P2 runtime-next 合同骨架
      -> P3 physical geometry kernel
        -> P4 transaction and data arrival
          -> P5 input, scrollbar, and motion
            -> P6 demo cutover and hardening
```

不要跳阶段。后续阶段依赖前一阶段已经建立的 ownership、diagnostics 和 review 结论。

## P0 文档和边界重建

目标：

- 把旧 runtime 明确降级为 `runtime.deprecated` 参考。
- 定义 runtime-next 的 ownership、模块边界、禁止项和阶段门禁。
- 移除旧 Phase 1 / Phase 2 增量改造路线对后续实现的误导。

任务：

- [x] 审查当前 `docs/viewport-runtime`、`docs/architecture`、`src/runtime` 文档和代码结构。
- [x] 覆盖更新本路线图。
- [x] 新增 runtime-next 架构入口，说明 `runtime.deprecated` 与 `runtime-next` 的关系。
- [x] 更新文档索引和旧 runtime README 的边界说明。
- [x] 不开始任何 runtime-next 代码实现。

本阶段禁止：

- 移动 `src/runtime` 目录。
- 新建 runtime-next TypeScript 代码。
- 修改 React adapter 或 demo 行为。
- 为了让旧 runtime 看起来兼容新文档而改旧实现。

退出标准：

- 文档中能清楚回答：旧 runtime 为什么不能继续承载新架构。
- 文档中能清楚回答：runtime-next 哪一层唯一拥有几何。
- 后续实现的第一步是结构隔离，而不是继续修补旧 runtime。

Review 检查点：

- `src/runtime` 是否被标记为 deprecated/reference。
- `runtime-next` 是否被描述为新承载体，而不是旧 runtime 的子模块。
- 路线图是否不再沿用旧 Phase 1 / Phase 2。

## P1 仓库结构隔离

依赖：

- P0 已完成。

目标：

- 在代码层隔离旧实现，避免后续 import 或测试继续默认落回旧 runtime 心智。
- 保留 demo / deprecated React / test 底座，作为旧 runtime 行为参考；runtime-next 的 React adapter 必须进入自身 `components/` 并完全重写。

任务：

- [x] 将当前 `src/runtime` 改名为 `src/runtime.deprecated`。
- [x] 新建空的 `src/runtime-next` 目录，只允许 README、components README、导出占位和类型骨架。
- [x] 更新 package/export 入口，使默认 demo 仍能在旧 runtime 上运行，runtime-next 以显式实验入口存在。
- [x] 标记旧 runtime 测试为 deprecated contract tests，避免作为 runtime-next 设计门禁。
- [x] 建立 import guard，禁止 runtime-next import `src/runtime.deprecated` 和旧 `src/react`。
- [x] 在 runtime-next README 中写入文件大小、类型拆分、co-located 组织和中文注释规则。

P1 实施记录：

- 旧 runtime 已迁移到 `src/runtime.deprecated`。
- `src/runtime-next` 已建立结构占位，仅含 `README.md`、`components/README.md`、`index.ts`、`types.ts`。
- 根导出已保留 deprecated runtime；`./runtime-next` package 实验入口指向独立的 runtime-next JS / d.ts 产物。
- 旧 runtime tests 已标记为 deprecated contract tests。
- `runtime-next` import guard 已加入 ESLint 与源码扫描测试，覆盖 deprecated runtime 与旧 React adapter。
- 验证：`npm run typecheck`、`npm run lint`、`npm run test`、`npm run build` 已通过；根 package 只导出 deprecated runtime / React，`x-message-list/runtime-next` package 子路径只导出 `RUNTIME_NEXT_STATUS`。

本阶段禁止：

- 从旧 runtime 复制 transaction、projection、spacer、scrollFrame、bottom lock 实现。
- 从旧 `src/react` 复制 component、hook、custom scrollbar 实现。
- 在 runtime-next 中实现真实 paging、measurement、motion 或 scrollbar。
- 让 runtime-next API 默默转发到 deprecated runtime。
- 删除 demo 或旧 runtime 行为参考。

退出标准：

- 新旧 runtime 在路径和 import 层面隔离。
- demo 仍可运行在旧 runtime 上。
- runtime-next 可以被单独 typecheck，但没有承载旧实现。

Review 检查点：

- 是否存在 `runtime-next -> runtime.deprecated` import。
- 是否存在 `runtime-next` API 直接委托 deprecated runtime。
- 是否保留旧 demo 底座，且未把 demo policy 塞进 runtime-next。
- 是否已经把 no god file、类型拆分、co-located、中文注释规则写进 runtime-next 本地维护说明。

## P2 runtime-next 合同骨架

依赖：

- P1 已完成。

目标：

- 先建立 public surface、snapshot、commit token、physical metrics、diagnostics、command intake 的空合同。
- 在没有真实几何算法前，先让 ownership 通过类型和测试固定下来。

任务：

- [x] 定义 runtime-next public facade。
- [x] 定义 projection snapshot，只包含 React 需要渲染的字段。
- [x] 定义 `ProjectionCommitToken`，并要求 React ack 原样回传。
- [x] 定义 `PhysicalScrollMetrics`，与 projection snapshot 分离。
- [x] 定义 diagnostics record 和 architecture violation 分类。
- [x] 定义 command intake，command 只表达 semantic intent。
- [x] 写 ownership guard tests，证明非 geometry 层不能发布 geometry。
- [x] 类型按领域拆分，避免 `types.ts` 变成无边界类型垃圾桶。

P2 实施记录：

- `src/runtime-next/MessageViewportRuntime.ts` 已提供 public facade 空合同；不实例化、不 import、不转发 deprecated runtime。
- projection snapshot、commit token、physical metrics、diagnostics、command/data 合同已对齐 `message-runtime-implementation-contract.md` 并按领域 co-located。
- public facade 使用主合同类型名，并保留 `RuntimeNext*` 兼容别名，避免实现签名与合同文档再次漂移。
- `MessageDataSnapshot.change.viewportModifier` 是必填 data hint；reserved modifier 在对应事务落地前会直接报错，不能被 P2 skeleton 静默吞掉。
- `ViewportPhase` 已对齐 physical segment / container 主规范：`IDLE | RECOVERING | SEGMENT_SHIFTING | DESTINATION_PENDING | MOTION_ACTIVE`，不再沿用旧 projection/measurement/correction phase。
- `ProjectionCommitToken` 覆盖 `feedId + generation + projectionRevision + segmentId + segmentRevision + transactionId`，并有精确匹配 helper。
- `geometry/publication/publication.types.ts` 是 geometry 后续内部发布面，没有从 package 入口导出。
- ownership / contract guard tests 已覆盖主合同 public facade、projection / metrics 字段、command/data semantic-only、非 geometry 领域不能发布 geometry mutation fields。
- import guard 已覆盖 deprecated runtime、旧 React adapter、root entry、package self-reference 和生产代码动态 import。
- 验证：`npm run typecheck`、`npm run lint`、`npm run test`、`npm run build` 已通过；`x-message-list/runtime-next` 只导出 `MessageViewportRuntime`、`RUNTIME_NEXT_STATUS`、`isProjectionCommitTokenEqual`；生产 runtime-next 源码无动态 import。

本阶段禁止：

- 实现真实 render window 选择。
- 写 `scrollTop`。
- 读取 raw DOM `scrollHeight` 作为语义输入。
- 根据 data arrival 改 spacer 或 segment。
- 把旧 runtime snapshot shape 原样搬进 runtime-next。

退出标准：

- projection snapshot 与 physical metrics 是两条订阅通道。
- commit token 能覆盖 `feedId + generation + projectionRevision + segmentId + segmentRevision + transactionId`。
- diagnostics 能表达 geometry owner violation。
- geometry publish API 不暴露给 command/data/React adapter。

Review 检查点：

- 是否能从类型层看出 geometry write surface 是私有的。
- 是否有任何 command/data API 能直接设置 spacer、render rows 或 `physicalWindowHeight`。
- 是否有任何 React adapter 合同要求读取 DOM `scrollHeight` 推导语义。
- 是否有核心文件因类型或合同堆积接近 god file，需要先拆分再继续。

## P3 physical geometry kernel

依赖：

- P2 已完成。

目标：

- 实现不跨段的单 active segment 几何内核。
- 先稳定 physical segment、render rows、local spacers、height budget、coverage 和 measurement correction。

任务：

- [x] 实现 `PhysicalSegment` 状态和 revision lifecycle。
- [x] 实现固定 `physicalWindowHeight` 的 segment budget。
- [x] 实现按高度预算选择 render rows。
- [x] 实现 local spacer solver，保证 `topSpacer + mountedRowsHeight + bottomSpacer === physicalWindowHeight`。
- [x] 实现 measurement fact ingestion，只产出 local correction 或 relayout intent。
- [x] 实现 safe scroll range 和 real row coverage。
- [x] 实现 short-feed 与 exceptional-row cap mode。
- [x] 输出 geometry diagnostics。

P3 实施记录：

- P3.0 已在 `src/runtime-next/geometry/config/config.ts` 收口默认 geometry 配置、diagnostics ring buffer 保留策略、payload 压缩方式、`minimumSafeBufferPx` 和稳定 `segmentId` 生成方式；这些值不再作为临时 guard 散落到后续 solver。
- P3.1 已在 `src/runtime-next/geometry/segment/` 新增 `PhysicalSegment` / `PhysicalSegmentDraft` / pending revision 状态类型，并用 `PhysicalSegmentRevisionController` 固定 revision lifecycle：projection 发布前分配 `segmentRevision`，ack 必须精确匹配 `ProjectionCommitToken`，abort 不复用已分配 revision。
- `budget/heightBudget.ts` 已实现 normal cap、short-feed budget 和 exceptional-row cap fallback；预算计算只用于 build / relayout，不作为 measurement delta 的 in-place mutation。
- `window/rowSelection.ts` 已按 estimated height budget 选择 render rows，`maxMountedItems` 只作为安全阀；`items.length` 只用于候选数据和 anchor fallback，不推导 physical height。
- `window/spacerSolver.ts` 已实现 local top/bottom spacer solver；normal / exceptional 模式保持高度守恒，short-feed 自然空白以 `naturalBlankHeight` 暴露，不伪装成 spacer。
- `measurement/coverage.ts` 已实现 safe scroll range、real row coverage、spacer-only viewport 和 short-feed coverage exception。
- `measurement/measurementCorrection.ts` 已实现 measurement fact / delta ingestion，只返回 local spacer correction 或 `segment-relayout` intent；short-feed measurement 变化不会把自然空白转成 spacer correction。
- `diagnostics/geometryDiagnostics.ts` 已输出 geometry-local `physical.*` diagnostics，并携带 dataRevision、segment revision、render window、spacer、height、cap 和 coverage 字段。
- `geometry/README.md` 已固定领域目录组织，P3 后续不再把实现、types 和 tests 平铺到 geometry 根目录。
- runtime-next public facade 仍不接真实 geometry；`RUNTIME_NEXT_STATUS.phase` 只标记 P3 内部 kernel in progress，`geometryImplemented` 仍为 `false`。
- 验证：`npm run typecheck`、`npm run lint`、`npm run test`、`npm run build` 已通过。

本阶段禁止：

- Segment shift。
- Adjacent prefetch。
- Follow-bottom motion。
- Custom scrollbar drag。
- Data arrival 触发几何 mutation。
- React adapter 参与几何决策。

退出标准：

- 同一 `segmentRevision` 内 `physicalWindowHeight` 冻结。
- 稳定帧中 physical metrics 与 projection spacers 可互相校验。
- coverage failure 不会暴露 spacer-only viewport。
- measurement 不能通过直接改高 `physicalWindowHeight` 来吞掉 delta。

Review 检查点：

- 所有 render rows 和 spacers 是否只由 geometry kernel 发布。
- 是否还有 DataWindow length -> spacer/height 的路径。
- diagnostics 是否能指出 cap、coverage、height conservation 违约。
- geometry 领域内的 state、solver、types、diagnostics helper 和 tests 是否保持 co-located。

## P4 transaction and data arrival

依赖：

- P3 已完成。

目标：

- 将 data snapshot、semantic command 和 geometry kernel 连接成明确事务。
- 建立 bootstrap、projectionRefresh、segmentRelayout、segmentShift、jump/restore、followBottom 的时序。

任务：

- [ ] 实现 transaction runner 和 writer arbitration。
- [ ] 实现 bootstrap transaction。
- [ ] 实现 payload-only `projectionRefresh`。
- [ ] 实现 `segmentRelayout`。
- [ ] 实现 data arrival classifier，只产生 intent 或 no-op。
- [ ] 实现 pending shift / destination / follow-bottom resolution。
- [ ] 实现 `segmentShift`，目标 segment 的 rows、spacers、commit token 同一 projection 发布。
- [ ] 实现 jump / restore target segment 构造。
- [ ] 实现 follow-bottom latest segment 事务。

本阶段禁止：

- `prepend` / `append` 直接映射为 viewport transaction。
- data arrival 直接扩张 `scrollHeight`。
- prefetch 改变当前 projection rows 或 spacers。
- motion 跨不存在的全局高度。
- 事务外写 `scrollTop`。

退出标准：

- 每种 geometry mutation 都有 transaction id、commit token、diagnostics。
- pending `segmentRevision` 在 ack 前不能出现在 committed physical metrics。
- `projectionRefresh` 不改变任何 geometry 字段。
- data arrival 只满足 pending intent 或触发显式 transaction。

Review 检查点：

- 是否还有 scroll handler / ResizeObserver / data arrival 直接替换 rows。
- 是否存在旧 prepend/append transaction 名称。
- segment shift commit 后是否 rebase 到 safe zone，避免立即二次 shift。

## P5 input, scrollbar, and motion

依赖：

- P4 已完成。

目标：

- 把用户输入、custom scrollbar 和 motion 接到 committed physical metrics，而不是接到 DataWindow 或 DOM `scrollHeight`。

任务：

- [ ] 实现 custom scrollbar metrics 消费。
- [ ] 实现 direct scroll API 和 drag lock。
- [ ] 实现 pointerup 后的 pending shift 与 thumb freeze。
- [ ] 实现 wheel / trackpad momentum latch。
- [ ] 实现 target segment 内 bounded motion。
- [ ] 实现 latest-only bottom lock。
- [ ] 实现 high-frequency physical metrics subscriber，避免 React row tree 每帧 rerender。

本阶段禁止：

- drag 期间执行 segment shift。
- residual wheel delta 默认灌入新 segment。
- custom scrollbar 读取 DataWindow length 或 raw DOM `scrollHeight` 推导 thumb。
- history segment 的 physical bottom 设置 `LOCKED`。
- React state 拥有 high-frequency physical metrics。

退出标准：

- Thumb geometry 只依赖 committed physical metrics。
- Drag 在当前 segment 内线性、稳定，pointerup 后才 shift。
- Momentum 不形成 shift loop。
- Bottom lock 只可能发生在 latest segment 且 `hasMoreAfter === false`。

Review 检查点：

- 是否有多 writer 同时写 `scrollTop`。
- custom scrollbar 是否能在 projection rerender 之外更新。
- drag / motion / shift 的取消与 freeze 边界是否可观测。

## P6 demo cutover and hardening

依赖：

- P5 已完成。

目标：

- 在保留 demo/data 底座的前提下，将 demo 显式切到 runtime-next。
- 移除旧 runtime 对新架构开发的默认路径影响。

任务：

- [ ] 为 demo 增加 runtime-next 显式入口。
- [ ] 跑通 latest bootstrap、top/bottom paging、jump/restore、followBottom。
- [ ] 验证 short-feed、exceptional-row、coverage failure、shift loop suppression。
- [ ] 验证 custom scrollbar drag、thumb freeze、momentum latch。
- [ ] 将 deprecated runtime 的测试和文档降级为 reference。
- [ ] 更新 root README 和 public usage 到 runtime-next。

本阶段禁止：

- 删除旧 runtime 参考，除非 runtime-next 已覆盖对应必要行为。
- 让 demo 实现第二套 geometry engine。
- 为了通过 demo 临时放宽 geometry ownership。
- 用性能优化替代 correctness diagnostics。

退出标准：

- demo 的默认 runtime 是 runtime-next。
- 旧 runtime 不再是任何新架构开发的默认 import。
- 所有禁止项都有测试或 diagnostics 覆盖。
- 文档、demo、exports、测试入口一致。

Review 检查点：

- demo 是否只做 host / data / projection，不拥有 geometry。
- 是否仍有 `runtime.deprecated` 被新路径 import。
- 实际 runtime 行为是否能对应本文每个阶段的退出标准。

## 追踪规则

- 阶段未满足退出标准，不得标记完成。
- 每个阶段 review 必须先检查禁止项，再检查功能完整性。
- 新发现如果改变 ownership 或 geometry truth，先改架构文档，再继续实现。
- 旧 runtime 可以用于行为观察，但观察结论必须重新映射到 runtime-next ownership 后才能进入实现。
