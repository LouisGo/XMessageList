# Graphs

本目录用 Mermaid 图描述当前实现里真正需要跨文件理解的结构和流程。图表以当前源码为准，不替代
`docs/architecture/` 中的合同说明。

## 图表索引

- [module-boundaries.md](./module-boundaries.md)：package surface、运行时所有权边界和少量 type/helper dependency。使用 flowchart，因为它描述的是职责协作关系。
- [runtime-transaction.md](./runtime-transaction.md)：projection transaction 从 loaded segment 到 commit settle 的时序。使用 sequenceDiagram，因为重点是参与方和调用顺序。
- [runtime-states.md](./runtime-states.md)：viewport phase、edge slot、pending intent、destination/motion axes 的状态变化。使用 stateDiagram-v2，因为重点是有限状态和转移条件。
- [loaded-segment-store.md](./loaded-segment-store.md)：Loaded Segment Store 的 request token 与 segment modifier 生成。混合 stateDiagram-v2 和 flowchart，分别描述 token 生命周期和数据变换。
- [demo-and-e2e.md](./demo-and-e2e.md)：demo host 的 semantic event bridge 与 E2E harness。使用 sequenceDiagram，因为重点是异步协作链路。

## 维护原则

- 状态图只画真实状态，不把普通条件判断强行画成状态。
- 时序图只画跨对象/跨模块交互，不展开内部纯函数细节。
- 流程图只画所有权、依赖和数据变换，不表达时间顺序。
