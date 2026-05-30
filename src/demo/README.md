# Demo

`src/demo` is a local host implementation for exercising the package. It may
simulate feeds, persistence, mocks and E2E scenarios, but it must not take over
runtime ownership of scroll, measurement, paging latches or anchor correction.

## Directory Rules

- `components/` owns demo UI components.
- `data/` owns feed fixtures, mock persistence, request adapters and message API types.
- `mocks/` owns advanced mock publishers and test utilities.
- `runtime/` owns per-feed runtime cache helpers.
- `scenario/` owns scenario orchestration hooks, segment publishing, runtime event handling and command wiring.
- `styles/` owns CSS entry files used by the demo and E2E app.

Demo code should respond to semantic runtime events and publish data runtime
segments back to the viewport runtime. It should not inspect projection DOM to
repair runtime behavior.
