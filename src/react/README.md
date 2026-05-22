# React Adapter

React 18 projection layer for the framework-independent runtime.

## Directory Layout

- `index.ts` is the public adapter entry.
- `components/` owns the projection DOM shell.
- `hooks/` owns React subscription / commit-ack wiring.
- `scrollbar/` owns the custom scrollbar React shell, DOM controller,
  observer wiring, styles, and pure geometry helpers.
- `__tests__/` keeps adapter and geometry regression tests.

Rules:

- subscribe with `useSyncExternalStore`
- send `notifyProjectionCommitted` from `useLayoutEffect`
- register row/spacer/sentinel DOM through ref callbacks
- do not compute RenderWindow in React
- do not measure row height in React
- do not read or write `scrollTop` in React

The adapter standardizes IM viewport projection SOP without owning scrolling:

- render the fixed projection DOM shell
- render edge and follow-bottom slots
- overlay the custom scrollbar as a DOM-only direct-manipulation layer
- dispatch semantic follow-bottom commands
- expose runtime anchor persistence events to the app/demo

Demo code should provide data, message rendering, and labels only. It should not
query the runtime DOM or attach raw scroll listeners.
