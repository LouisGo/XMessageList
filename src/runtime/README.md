# Runtime

`src/runtime` owns viewport correctness for loaded-segment native scrolling. It
does not own data fetching, React rendering, feed selection, or demo behavior.

## Directory Rules

- Keep root files limited to `index.ts`, `internal.ts`, and this README.
- Put public contract types in `contracts/`.
- Put facade/controller orchestration in `controller/`.
- Put interaction state machines in `interactions/` and shared axes/types in `state/`.
- Put DOM refs, measurement, anchor and row metric code in `dom/`.
- Put scroll source, bottom lock and direct-scroll session code in `scroll/`.
- Put diagnostics/evidence/event builders in `events/`.
- Put commit/settlement/correction flows in `transactions/`.
- Keep data merge, trim and token logic in `data/`.
- Put cross-domain stateless helpers in `shared/`; other domains should not import from `controller/`.

Runtime code must not import React. Viewport runtime consumes immutable
`LoadedSegment` snapshots and must not merge, dedupe or reorder business items.
