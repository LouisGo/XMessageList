# Module Boundaries

## Package And Runtime Ownership

```mermaid
flowchart LR
  Host["App / Demo Host"]
  Source["Main / Bridge or mock API"]
  Registry["MessageList Session Registry<br/>sessions, adapter routing, request bridge"]
  SegmentStore["Loaded Segment Store<br/>merge, dedupe, trim, request tokens"]
  Runtime["Viewport Runtime<br/>scroll, motion, measurement, correction, latches"]
  React["React Adapter<br/>snapshot projection, DOM refs, commit ack"]
  DOM["Native DOM Scroll Container<br/>real scrollHeight and row rects"]
  Overlay["Custom Scrollbar Overlay<br/>native metric mirror"]
  E2E["E2E Harness<br/>actions, evidence, oracles"]

  Host -->|"create registry, provide adapters"| Registry
  React -->|"useMessageListSession(id)"| Registry
  Registry -->|"query latest / around / before / after"| Source
  Source -->|"ordered messages + boundary state"| Registry
  Host -->|"session.commands / session.rows"| Registry
  Registry -->|"request result or local mutation"| SegmentStore
  SegmentStore -->|"immutable LoadedSegment"| Runtime
  Runtime -->|"MessageListSnapshot"| React
  React -->|"render rows, triggers, bottom marker"| DOM
  React -->|"register refs + ProjectionCommitAck"| Runtime
  Runtime -->|"read rects / heights; write scrollTop"| DOM
  DOM -->|"scroll, resize, intersection"| Runtime
  Runtime -->|"semantic runtime events"| Registry
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
