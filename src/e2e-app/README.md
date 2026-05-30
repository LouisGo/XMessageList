# E2E App

`src/e2e-app` is the browser-side harness used by `e2e/runner`. It exposes
deterministic actions, evidence and oracles through the E2E bridge.

## Directory Rules

- `app/` owns the E2E React app shell.
- `actions/` owns action dispatch and DOM action helpers.
- `bridge/` owns the browser bridge, evidence serialization and failure artifacts.
- `oracles/` owns evidence, runtime, scroll and overlay assertions.

The E2E app may read public evidence and DOM attributes created for testing. It
must not reach into runtime private controller objects to pass an oracle.
