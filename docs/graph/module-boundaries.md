# Module Boundaries

## Package And Runtime Ownership

```mermaid
flowchart LR
  Host["App / Demo Host"]
  Source["Main / Bridge or mock API"]
  Data["Renderer Data Runtime<br/>merge, dedupe, trim, request tokens"]
  Runtime["Viewport Runtime<br/>scroll, measurement, correction, latches"]
  React["React Adapter<br/>snapshot projection, DOM refs, commit ack"]
  DOM["Native DOM Scroll Container<br/>real scrollHeight and row rects"]
  Overlay["Custom Scrollbar Overlay<br/>native metric mirror"]
  E2E["E2E Harness<br/>actions, evidence, oracles"]

  Host -->|"query latest / around / before / after"| Source
  Source -->|"ordered messages + boundary state"| Host
  Host -->|"request result or local mutation"| Data
  Data -->|"immutable LoadedSegment"| Runtime
  Runtime -->|"MessageListSnapshot"| React
  React -->|"render rows, triggers, bottom marker"| DOM
  React -->|"register refs + ProjectionCommitAck"| Runtime
  Runtime -->|"read rects / heights; write scrollTop"| DOM
  DOM -->|"scroll, resize, intersection"| Runtime
  Runtime -->|"semantic runtime events"| Host
  Overlay -->|"begin / write / end direct scroll"| Runtime
  Overlay -->|"read native scroll metrics"| DOM
  E2E -->|"bridge actions"| Host
  E2E -->|"stable evidence API"| Runtime
```

## Runtime Domain Map

```mermaid
flowchart TD
  Contracts["contracts/<br/>public runtime types"]
  Controller["controller/<br/>facade, queue, scheduler, orchestration"]
  Shared["shared/<br/>stateless identity and snapshot helpers"]
  Data["data/<br/>loaded segment merge, trim, tokens"]
  DOMDomain["dom/<br/>registry, measurement, anchor correction, row metrics"]
  Scroll["scroll/<br/>scroll source, bottom lock, direct scroll session"]
  Interactions["interactions/<br/>edge, underflow, destination, follow-bottom"]
  State["state/<br/>axes and shared interaction types"]
  Events["events/<br/>diagnostics, evidence, public event builders"]
  Transactions["transactions/<br/>post-commit settlement"]

  Controller --> Contracts
  Controller --> Shared
  Controller --> DOMDomain
  Controller --> Scroll
  Controller --> Interactions
  Controller --> State
  Controller --> Events
  Controller --> Transactions

  Data --> Contracts
  DOMDomain --> Contracts
  DOMDomain --> Shared
  DOMDomain --> Scroll
  DOMDomain --> Interactions
  Interactions --> Contracts
  Interactions --> State
  Interactions --> Scroll
  Events --> Contracts
  Events --> Shared
  Events --> DOMDomain
  Transactions --> Contracts
  Transactions --> DOMDomain
  Transactions --> Interactions
```

`controller/` 是唯一 orchestration owner；跨域复用的纯 identity/snapshot helper 应留在 `shared/`，避免 DOM、events、interactions 反向依赖 controller。
