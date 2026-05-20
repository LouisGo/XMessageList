# Message Viewport Runtime 文档

本目录描述新的 IM viewport runtime。当前重构口径已经切换为 **runtime-next from scratch**：旧实现已经隔离到 `src/runtime.deprecated`，新的结构占位位于 `src/runtime-next`。

`runtime-next` 仍以 **Physical Segment Windowing** 为核心，不再把已加载数据连续暴露为单一 `scrollHeight`。

核心规则：

```text
DataWindow owns data.
PhysicalSegment owns geometry.
CustomScrollbar consumes committed physical metrics.
Transaction owns mutation timing.
Diagnostics owns invariant enforcement.
```

## 阅读顺序

| 文档 | 用途 |
| --- | --- |
| [runtime-next-architecture.md](./runtime-next-architecture.md) | 新主入口。定义 `runtime.deprecated` / `runtime-next` 边界、ownership 和 review checklist。 |
| [roadmap.md](./roadmap.md) | 新实施路线。覆盖旧 Phase 1 / Phase 2 增量 graft 口径。 |
| [physical-segment-architecture.md](./physical-segment-architecture.md) | 几何主规范。定义 physical segment、不变量、shift、relayout、状态轴和 diagnostics。 |
| [runtime-container-architecture.md](./runtime-container-architecture.md) | runtime 内核模块、状态所有权、snapshot 边界。 |
| [window-and-spacer-algorithms.md](./window-and-spacer-algorithms.md) | physical window、spacer、mounted height budget、measurement correction。 |
| [transaction-and-scroll-timing.md](./transaction-and-scroll-timing.md) | segment shift、relayout、bootstrap、jump、follow-bottom 的 commit 时序。 |
| [scroll-motion-and-animation.md](./scroll-motion-and-animation.md) | 自定义滚动条拖拽、motion、thumb freeze、scrollTop 写入权。 |
| [react-projection-adapter-contract.md](./react-projection-adapter-contract.md) | React projection 的 DOM、ref、commit ack 和 custom scrollbar 边界。 |
| [message-runtime-implementation-contract.md](./message-runtime-implementation-contract.md) | 从零实现 runtime-next 时的外部合同。 |
| [performance-optimization-guide.md](./performance-optimization-guide.md) | MessageViewport 专用性能策略、新特性使用边界和禁止事项。 |
| [lifecycle-and-testing.md](./lifecycle-and-testing.md) | 生命周期、generation safety、未来验证矩阵。 |
| [research-notes.md](./research-notes.md) | 外部参考如何转译到本架构。 |

## runtime-next 目标

Runtime-next 是 renderer 内部的 imperative viewport engine。它拥有：

- physical segment 选择、shift 和 relayout
- local render window 和 spacer 预算
- DOM registry、measurement、height cache
- scroll intent classification 和 `scrollTop` 写入仲裁
- custom scrollbar geometry 输入
- bottom lock 语义
- transaction queue、React commit ack、diagnostics

React 只拥有：

- message row JSX
- projection DOM 结构
- ref callback 注册 DOM
- custom scrollbar overlay 的渲染和 pointer event 转发
- edge loading、follow-bottom、overlay slot
- runtime snapshot 订阅和 commit ack

React、demo、业务层都不能根据 raw `scrollTop` / `scrollHeight` 自行重建分页、thumb 几何、bottom lock 或 anchor recovery。

## 当前仓库边界

| Path | Status | Rule |
| --- | --- | --- |
| `src/runtime` | 已移除 | 不再作为实现或 import 入口。 |
| `src/runtime.deprecated` | 旧 runtime 参考实现 | 保留备份和必要行为参考，不接受新架构实现。 |
| `src/runtime-next` | P1 结构占位 | 只包含 README、components README、导出占位和类型骨架；后续从零增量实现 runtime 与 React projection adapter。 |
| `src/react` | deprecated React projection adapter | 与 `src/runtime.deprecated` 一起冻结，只服务旧 demo / 旧合同；不能被 runtime-next import 或复用。 |
| `src/demo` | demo / data host | 可复用 mock 与场景，不得实现第二套 geometry engine。 |

旧 runtime 和旧 React adapter 的行为可以作为场景参考，但实现结构不能迁入 runtime-next。尤其不能继承 DataWindow sized spacer、native `scrollHeight` 语义、旧 projection window slide、旧 bottom lock 判断或旧 custom scrollbar 实现。

## 架构断点

```text
scrollHeight = active PhysicalSegment local height budget
```

这是底层几何真相。后续实现如果发现必须让 `scrollHeight` 随已加载数据增长，说明设计已经偏离本文档。
