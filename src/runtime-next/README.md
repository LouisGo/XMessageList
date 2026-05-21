# runtime-next

`src/runtime-next` 是新的 Physical Segment Windowing runtime 承载体。
当前处于 P5 input, scrollbar, and motion 阶段。public facade 已委托 runtime-next
controller，把 data snapshot、semantic command、P3 geometry kernel、P5 input/motion
链路接成 commit-token 驱动的事务；demo cutover 仍留给 P6。

## 当前允许内容

- `README.md`：本地维护规则。
- `components/README.md`：runtime-next React adapter 重写边界。
- `index.ts`：实验入口，只导出 runtime-next 自身的 facade、helper 和类型。
- `MessageViewportRuntime.ts`：public facade 薄委托，不拥有几何逻辑。
- `types.ts`：公共类型聚合入口，具体类型必须按领域 co-located。
- `commands/`、`data/`、`diagnostics/`、`projection/`：P2 类型和最小合同 helper。
- `geometry/`：P3 physical geometry kernel，按 `config/`、`segment/`、`budget/`、`window/`、`measurement/`、`diagnostics/` 等领域 co-located。
- `controller/`、`transactions/`、`dom/`：controller、transaction runner、
  pending geometry publication、data arrival classifier、DOM registry / input observer
  和 P5 scroll coordination。
- `scroll/`：writer arbitration、drag / handoff / momentum interaction state、
  bounded motion 和 edge need latch。
- `components/`：runtime-next 自有 React projection adapter、custom scrollbar、
  hooks 和 scrollbar geometry helper；不复用旧 `src/react`。
- `__tests__/`：ownership / contract guard tests。

禁止从 `src/runtime.deprecated` 或旧 `src/react` import，也禁止把 runtime-next API
转发到旧 runtime。旧 runtime 和旧 React adapter 只能作为人工阅读的行为参考。

## Ownership

runtime-next 后续只能由 physical geometry layer 发布几何事实：

- render rows
- local top/bottom spacers
- `physicalWindowHeight`
- `segmentRevision`
- `PhysicalScrollMetrics`
- segment shift / relayout 的几何结果

command、data、React adapter、demo 和 deprecated runtime 都不能成为 geometry owner。

`geometry/publication/publication.types.ts` 区分 pending projection 与 committed
metrics。Projection 可以发布 pending rows/spacers/commitToken；`PhysicalScrollMetrics`
只能在 ack + promote 后更新。它不能从 package 入口导出，也不能被 command/data/components
领域 import。

## 文件组织规则

- 纯逻辑文件不超过 300 行。
- 核心 class、React 组件、adapter 文件不超过 500 行。
- 大块 TypeScript 类型必须拆到 co-located `types.ts` 或 `*.types.ts`。
- 同一领域的 state、logic、types、diagnostics helpers 和 tests 优先 co-located。
- 不为了“公共”提前抽 shared；只有稳定复用且 ownership 清楚时才抽出。

## 注释规则

关键 ownership、事务时序、commit token 校验和 geometry invariant 必须写精准中文注释。
注释说明边界保护什么，不能复述显而易见的赋值、getter 或 guard。
