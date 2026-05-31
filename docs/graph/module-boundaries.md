# Module Boundaries

## Package And Runtime Ownership

```mermaid
flowchart LR
  Host["App / Demo Host"]
  Source["Main / Bridge or mock API"]
  Manager["MessageList Manager<br/>sessions, adapter routing, request bridge"]
  Data["Renderer Data Runtime<br/>merge, dedupe, trim, request tokens"]
  Runtime["Viewport Runtime<br/>scroll, motion, measurement, correction, latches"]
  React["React Adapter<br/>snapshot projection, DOM refs, commit ack"]
  DOM["Native DOM Scroll Container<br/>real scrollHeight and row rects"]
  Overlay["Custom Scrollbar Overlay<br/>native metric mirror"]
  E2E["E2E Harness<br/>actions, evidence, oracles"]

  Host -->|"create manager, provide adapters"| Manager
  React -->|"useMessageListSession(id)"| Manager
  Manager -->|"query latest / around / before / after"| Source
  Source -->|"ordered messages + boundary state"| Manager
  Host -->|"session.commands / session.rows"| Manager
  Manager -->|"request result or local mutation"| Data
  Data -->|"immutable LoadedSegment"| Runtime
  Runtime -->|"MessageListSnapshot"| React
  React -->|"render rows, triggers, bottom marker"| DOM
  React -->|"register refs + ProjectionCommitAck"| Runtime
  Runtime -->|"read rects / heights; write scrollTop"| DOM
  DOM -->|"scroll, resize, intersection"| Runtime
  Runtime -->|"semantic runtime events"| Manager
  Overlay -->|"begin / write / end direct scroll"| Runtime
  Overlay -->|"read native scroll metrics"| DOM
  E2E -->|"bridge actions"| Host
  E2E -->|"stable evidence API"| Runtime
```

## Runtime Ownership Map

```mermaid
flowchart TD
  Contracts["contracts/<br/>public runtime types"]
  Controller["controller/<br/>facade, queue, scheduler, orchestration"]
  Shared["shared/<br/>stateless identity and snapshot helpers"]
  Data["data/<br/>loaded segment merge, trim, tokens"]
  DOMDomain["dom/<br/>registry, measurement, anchor correction, row metrics"]
  Scroll["scroll/<br/>scroll source, bottom lock, direct scroll session"]
  Motion["motion/<br/>bounded JS scroll engine"]
  Interactions["interactions/<br/>edge, underflow, destination, follow-bottom"]
  State["state/<br/>axes and shared interaction types"]
  Events["events/<br/>diagnostics, evidence, public event builders"]
  Transactions["transactions/<br/>post-commit settlement"]

  Controller --> Contracts
  Controller --> Shared
  Controller --> DOMDomain
  Controller --> Scroll
  Controller --> Motion
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
  Interactions -.->|"measurement input types"| DOMDomain
  Events --> Contracts
  Events --> Shared
  Events --> DOMDomain
  Scroll -.->|"RuntimeMeasurement type"| DOMDomain
  Motion -.->|"ScrollMotionOptions type"| Contracts
  Motion -.->|"ScrollSource type"| Scroll
  Transactions --> Contracts
  Transactions --> DOMDomain
  Transactions --> Interactions
  Transactions -.->|"ScrollMotionSource type"| Motion
```

Legend: solid arrows describe ownership, orchestration, or collaboration. Dashed arrows describe type/helper dependencies that are not ownership edges.

`controller/` 是唯一 orchestration owner；跨域复用的纯 identity/snapshot helper 应留在 `shared/`，避免 DOM、events、interactions 反向依赖 controller。
本图不是完整 import graph；它只标出理解当前 runtime 分域时最容易误判的边界。
