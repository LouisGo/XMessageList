# 消息视口 Runtime 实施路线图

本文是执行追踪文档，不是架构规范。架构口径以 `physical-segment-architecture.md` 和各合同文档为准。

## 使用方式

- 每次开始实现前，先确认当前阶段、依赖关系和退出标准。
- 每次结束实现后，更新本文中的勾选项、状态和阻塞项。
- 新发现如果改变架构口径，先改主规范，再继续实现。
- 性能优化指南只作为实现后的优化建议，不作为阶段门禁。

状态标记：

- `[ ]` 待处理
- `[~]` 进行中
- `[x]` 已完成
- `[!]` 已阻塞

## 当前状态

- 当前阶段：阶段 0（`Phase 0`）
- 整体状态：架构文档已具备实现条件，代码实现尚未开始。
- 下一步：进入阶段 0，完成代码现状盘点和实现切分计划。

## 不可违背的硬边界

这些规则跨越所有阶段。任何实现违反其中一条，都必须停下来回到架构文档。

- `DataWindow` 只拥有数据可用性。
- `PhysicalSegment` 拥有滚动几何。
- `scrollHeight` 不能随已加载 DataWindow 数量增长。
- 同一 `segmentRevision` 内 `physicalWindowHeight` 必须冻结。
- `projectionRefresh` 只能刷新行内容负载，不能改变几何。
- 相邻段预取只表达数据准备状态，不能发布已提交几何。
- `prepend` / `append` 只作为 DataWindow 数据变更语义存在，不能作为 viewport 事务类型。
- safe scroll range 覆盖率必须用 `realRowCoveragePx >= minRealRowCoveragePx` 验证；short-feed 是显式特例。
- React、demo、业务层不能从原始 DOM 滚动状态推导分页、bottom lock、anchor recovery 或 thumb geometry。

## 依赖顺序

```text
阶段 0（Phase 0）：现状盘点与切分计划
  -> 阶段 1（Phase 1）：合同管线与观测面
    -> 阶段 2（Phase 2）：物理几何核心
      -> 阶段 3（Phase 3）：DataWindow 到几何事务
        -> 阶段 4（Phase 4）：输入、滚动条与运动
          -> 阶段 5（Phase 5）：验证与加固
```

不要调整阶段顺序。后续阶段依赖前置阶段已经建立的状态、diagnostics 和 transaction 保证。

## 阶段 0（Phase 0）：现状盘点与切分计划

目标：

- 在修改 runtime 行为前，把现有实现映射到新架构。
- 明确文件归属、重写边界和删除边界。
- 防止为了兼容旧路径而保留连续 `scrollHeight` 模型。

任务：

- [ ] 找出现有 runtime、adapter、custom scrollbar、measurement、edge paging、diagnostics 相关文件。
- [ ] 标记需要重写、保留、删除的文件。
- [ ] 找出所有从 DataWindow 长度或原始 DOM `scrollHeight` 推导 spacer、thumb size、bottom lock、pagination、anchor recovery 的路径。
- [ ] 确定第一段实现切片和对应验证命令。
- [ ] 若发现新的架构矛盾，先记录到对应规范文档，再开始实现。

产物：

- 更新后的路线图勾选项。
- 下一轮开发可直接执行的实现切分计划。

退出标准：

- geometry、data、adapter、transaction、diagnostics 都有明确归属。
- 第一段代码实现不需要再补架构解释。

停顿条件：

- 现有代码必须依赖 DataWindow 派生的 `scrollHeight` 才能推进。
- React 或业务层必须保留原始滚动所有权才能推进。
- 当前切片需要引入会恢复旧全局 spacer 语义的兼容层。

## 阶段 1（Phase 1）：合同管线与观测面

依赖：

- 阶段 0 已完成。

目标：

- 在改变几何行为前，先建立公开合同和 diagnostics 面。
- 让错误几何尽早可见。

任务：

- [ ] 在 projection snapshot 和 commit ack 中加入或更新 `ProjectionCommitToken`。
- [ ] 分离低频 projection snapshot 和高频 physical metrics。
- [ ] 补齐规范要求的 `PhysicalScrollMetrics` 字段。
- [ ] 为硬边界违约增加 diagnostics record。
- [ ] 为 `projectionRefresh` 建立显式 payload-only 路径。
- [ ] 确保 adapter 原样回传 commit token，而不是重建部分 ack。

本阶段禁止：

- 实现 segment shift 行为。
- 实现 custom scrollbar drag 行为。
- 改动超出合同需要的 DataWindow merge 语义。

退出标准：

- token ack 前，pending `segmentRevision` 不能暴露为 committed metrics。
- Physical metrics 能报告 segment id/revision、cap mode、safe range、coverage、drag/freeze/momentum、prefetch state。
- Diagnostics 能识别 DataWindow-to-geometry coupling。

## 阶段 2（Phase 2）：物理几何核心

依赖：

- 阶段 1 的 token、metrics、diagnostics 管线已完成。

目标：

- 实现不跨段的 physical segment 几何。
- 在引入 shift 之前，先稳定 measurement、spacer 和 coverage。

任务：

- [ ] 实现带 logical bounds 和 committed `physicalWindowHeight` 的 `PhysicalSegment` 状态。
- [ ] 实现 physical budget 内的 render window 选择。
- [ ] 实现 top/bottom local spacer 求解，并保持总高度守恒。
- [ ] 实现 mounted row measurement 和 local spacer correction。
- [ ] 实现 safe scroll range 和 real-row coverage 判定。
- [ ] 将 `SegmentRelayout` 实现为独立 transaction。
- [ ] 实现 short-feed 和 exceptional-row cap mode。

本阶段禁止：

- Segment shift。
- Adjacent segment prefetch。
- Wheel / drag 边界行为。
- Follow-bottom motion。

退出标准：

- 同一 `segmentRevision` 内，measurement 不能改变 `physicalWindowHeight`。
- 稳定帧中满足 `topSpacer + mountedRowsHeight + bottomSpacer === physicalWindowHeight`。
- Coverage failure 触发 relayout 或 diagnostics，不暴露 spacer-only viewport。
- Relayout 不能改变 logical segment identity，也不能隐式跨越 segment bounds。

## 阶段 3（Phase 3）：DataWindow 到几何事务

依赖：

- 阶段 2 的几何核心已稳定。

目标：

- 将 DataWindow 更新连接到显式 viewport transaction，同时避免几何重新绑定已加载数据量。

任务：

- [ ] 实现 DataWindow arrival classifier。
- [ ] 实现 pending shift resolution。
- [ ] 将 adjacent segment prefetch band 实现为纯数据准备状态。
- [ ] 实现带 token 的 projection commit 和安全区 rebase 的 `SegmentShift` transaction。
- [ ] 实现 `READY_FOLLOW_BOTTOM_PENDING` 的 data arrival 优先级。
- [ ] 实现 `jump` / `restore` target segment 构造。
- [ ] 强制执行 `projectionRefresh` payload-only 边界。

本阶段禁止：

- 将 `prepend` / `append` 直接映射为几何事务。
- 因 DataWindow 增长而扩张 `scrollHeight`。
- 由 prefetch 改变当前 projection rows 或 spacers。

退出标准：

- `prepend` / `append` 只更新 DataWindow，并只满足 pending intent。
- `SegmentShift` 是当前 segment 到 adjacent/target segment 的唯一桥梁。
- 预取未命中会保持当前 segment 稳定且可观测。
- Follow-bottom intent 不会被普通 append refresh 吞掉。

## 阶段 4（Phase 4）：输入、滚动条与运动

依赖：

- 阶段 3 的 segment transactions 已完成。

目标：

- 将用户输入连接到已提交 physical metrics，避免隐藏的几何写入。

任务：

- [ ] 实现 custom scrollbar metrics 消费。
- [ ] 实现 thumb drag lock 和 pointer 生命周期。
- [ ] 实现 pointerup shift 后的 thumb freeze。
- [ ] 实现 wheel / trackpad momentum latch 和 residual delta 抑制。
- [ ] 实现 current/target segment 内的 bounded motion。
- [ ] 实现只允许 latest segment 且 `hasMoreAfter === false` 的 bottom lock。

本阶段禁止：

- drag 期间执行 segment shift。
- 默认把 residual wheel delta 写入刚 shift 完的新 segment。
- 读取 DataWindow 长度或原始 DOM `scrollHeight` 计算 thumb size。
- 让 React state 拥有高频 physical metrics。

退出标准：

- Drag 在当前 segment 内保持线性，且只在 pointerup 后 shift。
- Momentum 不会导致 shift loop。
- Custom scrollbar thumb geometry 只依赖 committed physical metrics。
- 历史 segment 的 physical bottom 不能设置 bottom lock。

## 阶段 5（Phase 5）：验证与加固

依赖：

- 阶段 4 的输入和运动行为已完成。

目标：

- 证明新 runtime 在边界场景和高风险交互下稳定。

任务：

- [ ] 验证 bootstrap、relayout、shift、jump、restore、followBottom。
- [ ] 验证 short-feed、exceptional-row、cap exceeded、coverage failure。
- [ ] 验证 drag freeze、momentum latch、prefetch miss、shift loop suppression。
- [ ] 验证每条不可违背硬边界都有 diagnostics。
- [ ] 在不削弱正确性的前提下采纳性能优化指南建议。
- [ ] 移除仍暗示 continuous DataWindow geometry 的旧文档或旧代码路径。

退出标准：

- 没有已知路径从已加载 DataWindow 数量推导物理几何。
- Diagnostics 能暴露所有硬边界违约。
- 性能优化不会改变 transaction semantics 或 ownership boundaries。
- 后续实现可以继续按本路线图和规范进行分阶段 review。

## 追踪规则

- 不满足退出标准时，不能把阶段标记为完成。
- 有风险时宁可增加一条阻塞记录，也不要把风险静默推到下一阶段。
- 不要把大范围重构塞进某个阶段，除非它是该阶段退出标准的必要条件。
