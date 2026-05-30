# Data Runtime

## Request Token Lifecycle

```mermaid
stateDiagram-v2
  [*] --> NoRequest
  NoRequest: no pending request for kind
  Pending: pending requestToken, generation, kind
  Consumed: matching token consumed
  Stale: stale or mismatched token

  NoRequest --> Pending: createRequestToken(kind)
  Pending --> Pending: adoptRequestToken(same generation)
  Pending --> Consumed: consumeRequest(token, expected kind, current by kind)
  Pending --> Stale: missing token, wrong kind, wrong generation, or replaced by newer token
  Consumed --> NoRequest: create LoadedSegment
  Stale --> NoRequest: return applied=false
```

`around` adoption 会清掉 current `latest`；`latest` adoption 会清掉 current `around`。这让 destination 和 follow-latest 在 data-runtime token 层互斥。

## Segment Modifier Creation

```mermaid
flowchart TD
  RequestResult["request result or local mutation"]
  Latest["resetLatest / resetLatestFromRequest"]
  Around["resetAround / resetAroundFromRequest"]
  Before["extendBefore"]
  After["extendAfter"]
  Patch["patchItems / replaceItems"]
  Remap["applyIdentityRemap"]
  Trim["trimToBudget"]
  Create["createSegment increments segmentRevision"]
  ResetGen["reset increments generation and clears pending requests"]
  MergeBefore["mergeBeforeItems + dedupeItems"]
  MergeAfter["mergeAfterItems + dedupeItems"]
  PatchItems["patch or replace + dedupeItems"]
  RemapItems["applyIdentityRemaps + dedupeItems"]
  TrimItems["trimAroundKey protected by viewport anchor or tail"]
  Segment["LoadedSegment<br/>items, boundaries, anchor, modifier"]

  RequestResult --> Latest --> ResetGen --> Create
  RequestResult --> Around --> ResetGen
  RequestResult --> Before --> MergeBefore --> Create
  RequestResult --> After --> MergeAfter --> Create
  RequestResult --> Patch --> PatchItems --> Create
  RequestResult --> Remap --> RemapItems --> Create
  RequestResult --> Trim --> TrimItems --> Create
  Create --> Segment

  Segment -->|"modifier reset-latest"| RuntimeLatest["Viewport follows latest or bootstraps"]
  Segment -->|"modifier reset-around"| RuntimeAround["Viewport resolves destination or restore"]
  Segment -->|"modifier extend-before / extend-after"| RuntimeEdge["Viewport settles matching edge latch"]
  Segment -->|"modifier patch / identity-remap / trim-before / trim-after"| RuntimePatch["Viewport preserves or remaps anchor"]
```
