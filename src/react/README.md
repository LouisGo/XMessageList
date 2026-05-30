# React Adapter

`src/react` projects runtime snapshots into DOM and reports commit acknowledgements
back to runtime. It does not own scroll correction, edge latches or anchor
persistence.

## Directory Rules

- `components/` owns the projection shell, rows, commit ack and runtime event bridge.
- `hooks/` owns external-store subscription helpers.
- `scrollbar/` owns the optional custom scrollbar overlay, metric reading, geometry and styles.
- `types.ts` and `index.ts` remain the public adapter surface.

React may use `src/runtime/index.ts` and `src/runtime/internal.ts` only. Do not
import runtime private implementation files from adapter components.
