# Module Map

本文件描述当前 `next` 实现的源码组织。它是维护地图，不改变
[layering-and-ownership.md](./layering-and-ownership.md) 定义的所有权。

## Package Entries

- `src/index.ts` 是 package 根出口，只暴露 manager entry、`MessageList`、React provider/hooks、runtime facade 和 public contract types。
- `src/data.ts` 是 `x-message-list/data` 子路径出口，只暴露 data runtime 接入合同。
- 内部目录不作为 public deep import 承诺；业务接入只能依赖 package exports。

## Runtime

`src/runtime` 是 framework-independent viewport runtime。根目录只保留 barrel：

- `index.ts`：runtime public contract barrel。
- `internal.ts`：React adapter-private barrel。
- `README.md`：runtime 维护说明。

内部按职责分域：

- `contracts/`：public/runtime contract types，如 identity、segment、snapshot、events、options。
- `controller/`：runtime facade、controller、transaction queue、scheduler 和 controller helpers。
- `state/`：状态轴与 interaction 共享类型。
- `interactions/`：edge、underflow、destination、follow-bottom 和 post-commit 协调器。
- `dom/`：DOM registry、measurement、anchor correction、viewport anchor events、row metric cache 和 DOM interaction wiring。
- `scroll/`：scroll source、bottom lock、direct scrollbar session 和 scroll intent coordinator。
- `events/`：diagnostics、evidence 和 runtime public event builders。
- `transactions/`：commit 后 settlement / correction 流程。
- `data/`：data runtime，负责 merge、dedupe、identity remap、trim 和 request token。
- `shared/`：跨 runtime 域复用的无状态 helper；不能持有 controller orchestration 或 DOM ownership。

## Manager

`src/manager` 是应用级会话编排层：

- `manager.ts`：`createMessageListManager` 和 keepAlive session retention。
- `session.ts`：单会话 viewport runtime、data runtime、request bridge、memory restore 和 controller facade。
- `readReceipt.ts`：基于 viewport observation 的批量已读 worker，不经过 React state。
- `rowAdapter.ts`：业务 row 到 runtime item/anchor 的归一化。
- `types.ts` / `index.ts`：manager public contract types 和 exports。

Manager 可以依赖 runtime public/data barrels；runtime 不能反向依赖 manager。

## React Adapter

`src/react` 是 React projection adapter：

- `components/`：provider lookup、projection DOM shell、row wrapper、commit ack 和 event bridge。
- `hooks/`：`useSyncExternalStore` snapshot/selector hooks。
- `scrollbar/`：custom scrollbar overlay、geometry、metric reading 和 styles。
- `types.ts` / `index.ts`：public adapter types 和 exports。

React adapter 不拥有 request、data merge、read receipt、scroll correction、edge latch 或 anchor persistence。
custom scrollbar overlay 只可镜像 native metrics，并通过 adapter-private runtime direct-scroll API 写入。

## Demo And E2E

`src/demo` 是 local host/demo：

- `components/`：demo UI shell。
- `data/`：feeds、mock persistence、message API 和 request adapters。
- `mocks/`：advanced mock scenarios。
- `runtime/`：per-feed runtime cache。
- `scenario/`：scenario orchestration hooks、segment publisher、runtime event bridge 和 command wiring。
- `styles/`：demo/e2e app CSS entry and split style files。

`src/e2e-app` 是 browser-side E2E harness：

- `app/`：E2E React app。
- `actions/`：bridge actions and DOM action helpers。
- `bridge/`：browser bridge, evidence and artifact helpers。
- `oracles/`：evidence, runtime, scroll and overlay oracles。

`e2e/runner` 是 Node-side runner：

- `runScenario.ts`：thin CLI entry。
- `processes.ts`：preview server, Chrome process and wait helpers。
- `chromePage.ts`：CDP page client。
- `scenarioRunner.ts`：scenario action execution and evidence capture。
- `reporter.ts`：console output and summary artifacts。
- `scenarioRegistry.ts` / `scenarioSpecs.ts`：scenario selection and scenario definitions。

## Guardrails

- Moving files must preserve `src/index.ts`, `src/data.ts`, package exports and generated declaration shape.
- React/demo/e2e must not import runtime private modules except the approved public, data, or adapter-private barrels.
- Runtime non-controller domains must not import from `runtime/controller/`; move cross-domain pure helpers to `runtime/shared/`.
- Source files should stay below the repository file budget; split by stable ownership rather than by arbitrary line count.
