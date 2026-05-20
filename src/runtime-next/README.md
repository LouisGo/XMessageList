# runtime-next

`src/runtime-next` 是新的 Physical Segment Windowing runtime 承载体。
P1 阶段只建立仓库结构、导出占位和类型骨架，不实现真实 geometry、paging、
measurement、motion 或 scrollbar。

## P1 允许内容

- `README.md`：本地维护规则。
- `components/README.md`：runtime-next React adapter 重写边界。
- `index.ts`：实验入口占位，只导出 runtime-next 自身的状态和类型。
- `types.ts`：最小公共类型骨架。

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

## 文件组织规则

- 纯逻辑文件不超过 300 行。
- 核心 class、React 组件、adapter 文件不超过 500 行。
- 大块 TypeScript 类型必须拆到 co-located `types.ts` 或 `*.types.ts`。
- 同一领域的 state、logic、types、diagnostics helpers 和 tests 优先 co-located。
- 不为了“公共”提前抽 shared；只有稳定复用且 ownership 清楚时才抽出。

## 注释规则

关键 ownership、事务时序、commit token 校验和 geometry invariant 必须写精准中文注释。
注释说明边界保护什么，不能复述显而易见的赋值、getter 或 guard。
