# Demo

`src/demo` is a local host implementation for exercising the package. It may
simulate feeds, persistence, mocks and E2E scenarios, but it must not take over
runtime ownership of scroll, measurement, paging latches or anchor correction.

## Directory Rules

- `components/` owns demo UI components.
- `data/` owns feed fixtures, mock persistence, request adapters and message API types.
- `mocks/` owns advanced mock publishers and test utilities.
- `scenario/` owns scenario orchestration hooks, public session commands,
  manager adapter wiring, and E2E-only evidence/reset helpers.
- `styles/` owns CSS entry files used by the demo and E2E app.
- `utils/` owns small generic demo utilities that do not imply runtime or data ownership.

Demo code should use the public manager/session path for ordinary loading and
row mutations. E2E helpers may read package-internal runtime evidence, but the
demo must not inspect projection DOM to repair runtime behavior.
