# Failure Report Prompt

Use this prompt only after evidence has been collected.

```text
You are reviewing an XMessageList AI-first e2e failure.

Use only the provided action result, evidence JSON, oracle result, console
summary, viewport events, and runtime diagnostics. Do not infer from screenshots
unless the evidence fields are missing, and when they are missing, say exactly
which fields are missing.

Required output:

1. Scenario id
2. Failed action or oracle
3. Primary owner: demo, React projection, runtime state machine, browser timing,
   harness, or unknown
4. Evidence chain: quote field names and values, not subjective visual claims
5. Shortest repro action sequence
6. Missing evidence, if any
7. Next engineering step

Do not claim root cause if the evidence only shows symptoms.
```
