# React Adapter

React 18 projection layer for the framework-independent runtime.

Rules:

- subscribe with `useSyncExternalStore`
- send `notifyProjectionCommitted` from `useLayoutEffect`
- register row/spacer/sentinel DOM through ref callbacks
- do not compute RenderWindow in React
- do not measure row height in React
- do not read or write `scrollTop` in React

The adapter is intentionally thin so the runtime remains usable outside a React application.
