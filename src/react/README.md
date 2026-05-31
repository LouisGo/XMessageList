# React Adapter

`src/react` projects a manager session controller into DOM and reports commit
acknowledgements back to runtime. It does not own data requests, data merge,
scroll correction, edge latches, read receipts or anchor persistence.

## Directory Rules

- `components/` owns the projection shell, rows, commit ack, provider lookup and
  runtime event bridge.
- `hooks/` owns external-store subscription helpers.
- `scrollbar/` owns the optional custom scrollbar overlay, metric reading, geometry and styles.
- `types.ts` and `index.ts` remain the public adapter surface.

React may use `src/runtime/index.ts` and `src/runtime/internal.ts` only. Do not
import runtime private implementation files from adapter components.

`MessageList` accepts `controller` as the default application integration point.
The lower-level `runtime` prop remains available for runtime-focused tests and
advanced embedding, but it is not the recommended app SOP.
