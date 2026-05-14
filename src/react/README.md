# React Adapter

React 18 projection layer for the framework-independent runtime.

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
- dispatch semantic follow-bottom commands
- expose runtime anchor persistence events to the app/demo

Demo code should provide data, message rendering, and labels only. It should not
query the runtime DOM or attach raw scroll listeners.
