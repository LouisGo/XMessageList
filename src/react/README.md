# React Adapter

React 18 projection layer for the framework-independent runtime.

## Directory Layout

- `index.ts` is the public adapter entry.
- `components/` owns the projection DOM shell.
- `hooks/` owns React subscription / commit-ack wiring and stable adapter-state
  helpers.
- `scrollbar/` owns the custom scrollbar React shell, DOM controller,
  observer wiring, styles, and pure geometry helpers.
- `__tests__/` keeps adapter and geometry regression tests.

Rules:

- subscribe with `useSyncExternalStore`
- send `notifyProjectionCommitted` from `useLayoutEffect`
- keep event callbacks and element refs stable when React render identity is not
  part of the runtime contract
- register row/spacer/sentinel DOM through ref callbacks
- invalidate rows by item version/contentVersion or explicit
  `getRowRenderVersion`
- do not compute RenderWindow in React
- do not measure row height in React
- do not read or write `scrollTop` in React
- expose viewport activity through runtime observation events, not raw scroll
  events

The adapter standardizes IM viewport projection SOP without owning scrolling:

- render the fixed projection DOM shell
- render edge and follow-bottom slots
- overlay the custom scrollbar as a DOM-only direct-manipulation layer
- dispatch semantic follow-bottom commands
- expose runtime anchor persistence events to the app/demo
- expose read-only viewport observations for read receipts, pinned previews,
  sticky time, and analytics

Demo code should provide data, message rendering, and labels only. It should not
query the runtime DOM or attach raw scroll listeners.

Public read hooks:

- `useMessageViewportSnapshot(runtime)` reads the projection snapshot without
  sending commit acknowledgements.
- `useMessageViewportSelector(runtime, selector, isEqual?)` reads a stable
  selected slice without owning projection commit.

Observation API:

- `onViewportObservation` receives `viewportObservationChanged` events with
  visible item keys, visible ratios, visible range, scroll source, direction,
  activity, and anchor.
- Observation events come from the runtime's dedicated
  `subscribeViewportObservation` stream. Generic `subscribeEvent` listeners do
  not activate visible-range measurement.
- `renderViewportOverlay` receives `{ snapshot, observation, commands }`.
  Use it for fixed-time labels, pinned-message previews, or local overlays.
- Callback-only observation consumers do not update React adapter state; only
  viewport overlays retain the latest matching observation locally.
- Follow-bottom and jump actions from overlays must call `commands`, which
  dispatch runtime semantic commands instead of writing `scrollTop`.
