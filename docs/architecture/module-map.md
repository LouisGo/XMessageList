# Module Map

本文件描述当前源码组织。它是维护地图，不改变
[layering-and-ownership.md](./layering-and-ownership.md) 定义的所有权。

## Package Entries

- `src/index.ts` 是 package 根出口，只暴露 manager entry、React adapter、
  public session/adapter contract types。
- 不再提供 `x-message-list/data` 子路径；runtime/data runtime 是
  package-internal implementation。
- 根出口不暴露 runtime snapshot/event/loaded-segment 类型；React 需要的
  viewport callback 类型在 React adapter surface 中重新表达。
- 内部目录不作为 public deep import 承诺；业务接入只能依赖 package exports。

## Core

核心实现集中在 `src/x-message-list/core`：

- `manager/`：应用级会话编排层，创建并保留每个 conversation 的
  `MessageListSession`。
- `runtime/`：framework-independent viewport runtime 和 internal data runtime。

## Manager

`src/x-message-list/core/manager` 负责应用级生命周期：

- `manager.ts`：`createMessageListManager`、`getSession(id)` 和 keepAlive
  retention。
- `session.ts`：单会话 viewport runtime、data runtime、request bridge、
  `anchorMemory` restore/save、`readReceipts` worker 和 public session facade。
- `internal.ts`：package-internal session internals access，供 React adapter
  访问 runtime/view store；不从 package root 导出。
- `readReceipts.ts`：基于 viewport observation 的批量已读 worker，不经过
  React state。
- `rowAdapter.ts`：业务 row 到 runtime item/anchor 的归一化。
- `types.ts` / `index.ts`：manager public contract types 和 exports。

Manager 可以依赖 runtime public barrel 和 package-internal data runtime；runtime 不能反向依赖 manager。

## Runtime

`src/x-message-list/core/runtime` 是 framework-independent viewport runtime：

- `index.ts`：runtime public contract barrel，供 core/manager 与内部测试使用。
- `internal.ts`：React adapter-private barrel。
- `contracts/`：identity、segment、snapshot、events、options。
- `controller/`：runtime facade、controller、transaction queue、scheduler。
- `state/`、`interactions/`、`dom/`、`scroll/`、`events/`、
  `transactions/`：viewport 状态机、DOM 测量、滚动与诊断分域。
- `data/`：internal data runtime，负责 merge、dedupe、identity remap、trim 和
  request token。
- `shared/`：跨 runtime 域复用的无状态 helper；不能持有 controller
  orchestration 或 DOM ownership。

## React Adapter

`src/x-message-list/react` 是 React projection adapter：

- `components/`：provider context、projection DOM shell、row wrapper、commit ack
  和 event bridge。
- `hooks/`：`useMessageListSession` 等 React 集成。
- `scrollbar/`：custom scrollbar overlay、geometry、metric reading 和 styles。
- `types.ts` / `index.ts`：public adapter types 和 exports。

React adapter 不拥有 request、data merge、read receipts、scroll correction、
edge latch 或 anchor persistence。custom scrollbar overlay 只可镜像 native
metrics，并通过 adapter-private runtime direct-scroll API 写入。

## Demo And E2E

`src/demo` 是 local host/demo：

- `components/`：demo UI shell。
- `data/`：feeds、mock persistence 和 message API。
- `mocks/`：advanced mock scenarios。
- `scenario/`：demo manager adapter、scenario orchestration hooks、commands and
  local mutation wiring。
- `styles/`：demo/e2e app CSS entry and split style files。

普通 `src/demo` 路径必须作为 public session 接入样板：load history/future、
append/edit/delete/send/clear 都通过 `session.commands`、`session.rows`、
`session.outgoing` 或 `session.incoming` 完成。demo host 的 canonical persisted
feed 仍由 demo data API 管理；当前 loaded rows、edge status 和 viewport status
只能从 `session.getState()` / `useMessageListState` 推导，不维护独立 loaded-window
镜像，也不读取 runtime/dataRuntime。

`src/e2e-app` 是 browser-side E2E harness；它可以通过 E2E-only helper 读取
package-internal runtime snapshot/evidence，用于测试证据和 reset 辅助；应用渲染路径
仍然是 `<MessageList session={activeSession} />`。

## Guardrails

- Moving files must preserve `src/x-message-list/core/manager`,
  `src/x-message-list/core/runtime`, `src/x-message-list/react` boundaries.
- Package root must not export runtime/data runtime implementation types.
- React adapter must use runtime public or adapter-private barrels; demo and app
  code must go through manager/session APIs. E2E harness files are the only
  approved diagnostics exception.
- Runtime non-controller domains must not import from `runtime/controller/`; move
  cross-domain pure helpers to `runtime/shared/`.
- Source files should stay below the repository file budget; split by stable
  ownership rather than arbitrary line count.
