# Message Viewport Runtime 文档

本目录描述新的 IM viewport runtime。新架构以 **Physical Segment Windowing** 为核心，不再把已加载数据连续暴露为单一 `scrollHeight`。

核心规则：

```text
DataWindow owns data.
PhysicalSegment owns geometry.
CustomScrollbar owns visible scrollbar geometry.
Transaction owns mutation timing.
Diagnostics owns invariant enforcement.
```

## 阅读顺序

| 文档 | 用途 |
| --- | --- |
| [physical-segment-architecture.md](./physical-segment-architecture.md) | 主规范。先读。定义 physical segment、不变量、shift、relayout、状态轴和 diagnostics。 |
| [runtime-container-architecture.md](./runtime-container-architecture.md) | runtime 内核模块、状态所有权、snapshot 边界。 |
| [window-and-spacer-algorithms.md](./window-and-spacer-algorithms.md) | physical window、spacer、mounted height budget、measurement correction。 |
| [transaction-and-scroll-timing.md](./transaction-and-scroll-timing.md) | segment shift、relayout、bootstrap、jump、follow-bottom 的 commit 时序。 |
| [scroll-motion-and-animation.md](./scroll-motion-and-animation.md) | 自定义滚动条拖拽、motion、thumb freeze、scrollTop 写入权。 |
| [react-projection-adapter-contract.md](./react-projection-adapter-contract.md) | React projection 的 DOM、ref、commit ack 和 custom scrollbar 边界。 |
| [message-runtime-implementation-contract.md](./message-runtime-implementation-contract.md) | 从零实现 runtime 时的外部合同。 |
| [lifecycle-and-testing.md](./lifecycle-and-testing.md) | 生命周期、generation safety、未来验证矩阵。 |
| [research-notes.md](./research-notes.md) | 外部参考如何转译到本架构。 |

## Runtime 目标

Runtime 是 renderer 内部的 imperative viewport engine。它拥有：

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

## 架构断点

```text
scrollHeight = active PhysicalSegment local height budget
```

这是底层几何真相。后续实现如果发现必须让 `scrollHeight` 随已加载数据增长，说明设计已经偏离本文档。
