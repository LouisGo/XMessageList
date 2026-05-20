# runtime-next geometry

本目录是 P3 physical geometry kernel。根目录只保留跨 geometry 领域共享的
`types.ts` 和本说明；实现、类型和测试必须按领域 co-located。

## 目录

- `config/`：geometry 默认配置、segment id 生成和配置测试。
- `segment/`：`PhysicalSegment` 状态与 `segmentRevision` lifecycle。
- `budget/`：`physicalWindowHeight`、normal cap、short-feed 和 exceptional-row budget。
- `window/`：render row selection、item key helper 和 local spacer solver。
- `measurement/`：safe scroll range、real row coverage 和 measurement correction decision。
- `diagnostics/`：geometry-local `physical.*` diagnostics helper。
- `metrics/`：physical metrics 初始值和后续 metrics 派生入口。
- `publication/`：geometry 内部 publication shape；不能从 package 入口导出。

## 规则

- 不 import `runtime.deprecated`、旧 `src/react`、demo 或 DOM adapter。
- 不读取 raw DOM `scrollHeight`，不通过 DataWindow 长度推导 geometry。
- 纯逻辑文件不超过 300 行；大块类型保持在同领域 `*.types.ts`。
- 新的 geometry 能力优先放进对应领域目录，不再把文件平铺到本目录根部。
