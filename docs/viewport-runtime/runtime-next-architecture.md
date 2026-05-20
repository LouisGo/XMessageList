# runtime-next 架构边界

本文定义 runtime-next 的重写边界。它不描述旧 runtime 的修补方案，也不要求当前阶段实现代码。

## 1. Runtime Lineage

```text
src/runtime            -> removed after P1 structure isolation
src/runtime.deprecated -> deprecated runtime reference
src/runtime-next       -> P1 structure-only skeleton for the new runtime
```

当前仓库已经完成 P1 路径隔离：旧实现位于 `src/runtime.deprecated`，新实现入口位于 `src/runtime-next`。
P1 的 `runtime-next` 只包含 README、导出占位和类型骨架；真实 geometry、paging、measurement、motion 和 scrollbar 仍必须从后续阶段开始实现。

旧 runtime 可以参考的内容：

- public facade 的使用形态
- demo 与 deprecated React adapter 需要的最小外围接口
- 已经存在的用户可见行为样本
- 测试数据和 fake DOM 工具

旧 runtime 不可继承的内容：

- DataWindow 派生 global spacer / native `scrollHeight` 的模型
- window slide 继承 projection 的逻辑
- prepend / append 作为 geometry transaction 的路径
- scroll frame 内直接改 render window / spacer 的路径
- bottom lock 与当前 DOM physical bottom 混用的路径
- React adapter 或 demo 参与 runtime 几何判断的路径
- `src/react` 里的组件、hook、custom scrollbar 实现

## 2. Ownership Model

runtime-next 内部只允许一个几何真相来源：

```text
Physical Geometry Layer
```

它唯一拥有：

- active `PhysicalSegment`
- render rows
- local spacers
- `physicalWindowHeight`
- `segmentRevision`
- safe scroll range
- real row coverage
- cap mode
- physical metrics
- segment relayout / segment shift 的几何结果

其他层只能提交输入：

| Layer | Allowed input | Forbidden output |
| --- | --- | --- |
| Command intake | bootstrap / jump / restore / followBottom / reset intent | spacer、render rows、scrollTop target as raw offset |
| Data snapshot coordinator | ordered data availability, data revision, hasMore flags | segment revision、physical height、thumb geometry |
| React projection adapter | DOM commit ack, row/spacer refs, pointer events | render window choice、bottom lock、anchor recovery |
| Measurement adapter | measured row height facts | direct spacer mutation、direct `physicalWindowHeight` mutation |
| Demo / host | feed selection, runtime lifecycle, data request policy | viewport geometry, paging trigger from raw scroll |

## 3. Runtime-next Module Shape

目标目录只表达 ownership，不复制旧 runtime 的文件层级：

```text
src/runtime-next/
  index.ts
  MessageViewportRuntime.ts
  types.ts
  components/
  geometry/
  projection/
  transactions/
  data/
  commands/
  dom/
  scroll/
  diagnostics/
  __tests__/
```

P1 阶段只落地 `README.md`、`index.ts`、`types.ts` 和 `components/README.md`。P2 已开始落地 public facade、co-located contract types、commit token helper 和 ownership guard tests。下表是后续继续扩展的目标形态，不是把旧 runtime 或 `src/react` 文件搬进来的清单。

职责：

| Module | Responsibility |
| --- | --- |
| `MessageViewportRuntime.ts` | public facade, no geometry logic |
| `types.ts` | public contracts and stable snapshot/metrics types |
| `components/` | runtime-next-owned React projection adapter and custom scrollbar, rewritten from scratch |
| `geometry/` | physical segment state, render row selection, local spacer solver, metrics derivation |
| `projection/` | projection snapshot publishing and commit token matching |
| `transactions/` | bootstrap, projectionRefresh, segmentRelayout, segmentShift, jump/restore, followBottom |
| `data/` | data snapshot ingestion and pending intent resolution |
| `commands/` | semantic command validation and routing to transaction intents |
| `dom/` | DOM registry and measurement fact collection |
| `scroll/` | scrollTop writer arbitration, drag lock, momentum latch, bounded motion |
| `diagnostics/` | invariant checks, architecture violation records, recovery hints |

Import rule:

```text
geometry can be consumed by transactions/projection/diagnostics.
geometry cannot import React/demo/deprecated runtime.
commands/data/React cannot import geometry internals that mutate state.
runtime-next cannot import runtime.deprecated.
runtime-next cannot import src/react.
```

## 4. Engineering Constraints

runtime-next 禁止 god file。文件大小是 review 门禁，不是事后清理项：

- 纯逻辑文件不超过 300 行。
- 核心 class、React 组件、adapter 文件不超过 500 行。
- 测试文件不限制行数，但必须按场景组织，不能用超大测试掩盖实现耦合。
- 如果 TypeScript 类型占据大量内容，必须拆到 co-located `types.ts` / `*.types.ts`，不能塞进核心实现文件。

领域组织优先 high cohesion / low coupling：

- 同一领域的 state、pure logic、types、diagnostics helpers 和 tests 尽量 co-located。
- 不为了“公共”而提前抽 shared。只有当两个以上领域稳定复用且 ownership 清晰时，才抽到 shared。
- 目录边界按 runtime 领域切分，不按技术层散开同一行为。
- facade 只做组合和转发，不能重新堆积核心逻辑。

注释策略：

- 关键时序、ownership 边界、geometry invariant、transaction rebase、commit token 校验处必须有精准中文注释。
- 注释解释“为什么这里不能改”或“这个边界保护什么”，不复述代码表面行为。
- 不在显而易见的 guard、getter、赋值和类型声明上铺满注释。

## 5. Geometry Publish Boundary

runtime-next must keep two publish surfaces separate:

```text
Projection Snapshot: what React renders.
Physical Metrics: what scrollbar, scroll arbitration, and diagnostics observe.
```

Projection snapshot may contain:

- feed/generation/revision
- commit token
- items to render
- render window identity
- local top/bottom spacer values
- low-frequency UI slots such as edge/follow affordance state

Projection snapshot must not contain:

- live `scrollTop`
- raw DOM `scrollHeight`
- thumb geometry
- high-frequency drag/momentum state
- mutable geometry writer handles

Physical metrics must be derived only after geometry layer has a committed segment revision. Pending geometry may be visible to the active transaction, but cannot be exposed as committed metrics before the matching `ProjectionCommitToken` is acknowledged.

## 6. Commit And Measurement Contract

Every geometry-changing transaction follows one sequence:

```text
compute pending geometry in geometry layer
-> allocate next segmentRevision
-> publish projection with ProjectionCommitToken
-> React adapter echoes the same token after DOM commit
-> DOM layer reports measurement facts
-> geometry layer accepts correction or requests relayout
-> committed physical metrics are promoted
-> diagnostics records invariant result
```

Rules:

- Measurement facts do not mutate spacers directly.
- Commit ack without an exact token match is ignored.
- A transaction cannot publish two `segmentRevision` values for one geometry change.
- If measurement invalidates coverage/cap, open `segmentRelayout`; do not patch the current revision in place.

## 7. Data Arrival Contract

Data arrival is not geometry.

```text
setDataSnapshot
-> store availability
-> resolve pending semantic intent if any
-> otherwise no-op or payload-only projectionRefresh
```

`prepend` / `append` are data modifiers. They may satisfy a pending segment shift or follow-bottom intent, but they never directly choose render rows or spacers.

Adjacent prefetch is also data readiness. It can change diagnostics/pending state, but cannot publish active segment geometry.

## 8. Scroll Ownership

Only scroll arbitration inside runtime-next may write `scrollTop`.

Allowed writers:

- drag direct scroll within current segment
- segment shift rebase
- relayout / bootstrap / restore anchor correction
- bounded motion inside a committed target segment
- follow-bottom write inside latest segment

All writers must go through a single arbitration surface. Drag, motion, shift rebase and anchor correction cannot write concurrently.

## 9. Deprecated Runtime Reference Rules

When reading old runtime code:

1. Extract behavior, not implementation shape.
2. Reclassify the behavior into command, data, geometry, transaction, React or demo ownership.
3. If the behavior needs geometry, reimplement it inside runtime-next geometry/transaction modules.
4. If the old behavior depends on global `scrollHeight`, projection inheritance or DataWindow-sized spacer, do not port it.

Deprecated runtime tests may be used as scenario hints. They are not runtime-next acceptance tests until rewritten around physical geometry invariants.

## 10. Review Checklist

Every runtime-next PR must answer:

- Does any non-geometry module set render rows, spacers, `physicalWindowHeight`, `segmentRevision` or physical metrics?
- Does any path derive geometry from DataWindow length or raw DOM `scrollHeight`?
- Does any data modifier directly map to a viewport transaction?
- Are pending and committed physical metrics separated by commit token ack?
- Can diagnostics identify the owner when a geometry invariant is violated?
- Does runtime-next import anything from `runtime.deprecated`?
- Does any non-test source file exceed the line budget without being split?
- Are large type blocks split out from core implementation files?
- Is domain logic co-located instead of scattered across unrelated folders?
- Do critical ownership/timing/invariant points have precise Chinese comments?

If any answer fails, stop the implementation and revise the ownership boundary before continuing.
