# Runtime

Framework-independent IM message viewport runtime.

Core ownership:

- `MessageViewportRuntime` owns lifecycle, commands, projection publish, commit ack wait, and transaction routing.
- `ProjectionStore` is the React external-store boundary.
- `DomRegistry` stores container, row, spacer, and sentinel refs.
- `RenderWindowEngine` computes mounted item ranges from current data and anchor.
- `SpacerEngine` estimates top/bottom spacer height from height cache and item hints.
- `MeasurementEngine` performs commit-time sync measurement and ResizeObserver dirty batching.
- `ScrollIntentEngine` classifies runtime scroll writes and bottom-lock hysteresis.
- `ScrollMotionEngine` performs bounded runtime-owned destination scroll motion.
- `TransactionRunner` serializes viewport mutations.

Runtime code must stay free of React imports. React integration belongs in `src/react`.
