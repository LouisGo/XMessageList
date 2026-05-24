# First-round AI-first E2E Test Report

Date: 2026-05-24 (Asia/Shanghai)

Commit under test: `c773823304e2271472490dc872974983c76b0276`

## Scope

This report records the first full browser execution of the current
AI-first e2e assets in this repository.

No product or test code was changed during this test pass. The only intended
repository change is this report.

The worktree currently contains e2e assets beyond the original Phase 1 host
skeleton: P0/P1/P2/P3 scenario definitions, evidence/oracle code, agent task
files, and a local CDP runner. This test pass therefore validates the current
matrix as it exists in the repo, rather than limiting execution to the Phase 1
host-only slice.

## Tooling

Browser Use was attempted first. The Browser plugin was present, but its
required JavaScript execution entrypoint was not exposed in this session, so the
actual browser run used the project-owned CDP runner against a real Chromium
browser.

Fallback execution environment:

- Browser: Microsoft Edge `148.0.3967.83`
- Runner: `npm run e2e:p0 -- --priority all`
- Host: Vite dev server on an isolated localhost port
- CDP: isolated remote-debugging port and isolated browser profile
- Node: `v23.11.0`
- npm: `10.9.2`

This was not a Browser Use execution, but it still exercised the real `/e2e`
host, `window.__X_MESSAGE_LIST_E2E__` bridge, semantic actions, evidence
collection, and deterministic oracles through a real Chromium runtime.

## Verification Commands

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test` | PASS, 30 files / 222 tests |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm run build:demo` | PASS |
| `npm run e2e:p0 -- --priority all --base-url http://127.0.0.1:6173 --cdp http://127.0.0.1:9322 --out .logs/e2e-full-20260524-235741/artifacts --timeout-ms 60000` | FAIL, 9/14 scenarios passed |

Primary artifact root:

`.logs/e2e-full-20260524-235741/artifacts`

Failed-scenario retry artifact root:

`.logs/e2e-retry-failed-20260524-235957/artifacts`

## Summary

Overall full matrix result: FAIL.

P0 result: PASS, 3/3 scenarios.

Full matrix result: 9/14 scenarios passed.

| Priority | Passed | Failed | Result |
| --- | ---: | ---: | --- |
| P0 | 3 | 0 | PASS |
| P1 | 3 | 1 | FAIL |
| P2 | 2 | 2 | FAIL |
| P3 | 1 | 2 | FAIL |

## Scenario Results

| Priority | Scenario | Result | Retry | Notes |
| --- | --- | --- | --- | --- |
| P0 | `bootstrap.latest-bottom-lock` | PASS | not needed | Runtime idle and bottom locked. |
| P0 | `paging.prepend-anchor-preservation` | PASS | not needed | Anchor preservation oracle passed. |
| P0 | `bottom.user-scroll-up-append-no-follow` | PASS | not needed | User reading position was not stolen. |
| P1 | `bottom.locked-append-follow` | PASS | not needed | Append followed latest while locked. |
| P1 | `destination.quote-jump-visible-target` | FAIL | FAIL | `jump_to_quoted_message` failed with `missing_visible_quote`. |
| P1 | `dynamic-height.anchor-above-growth` | PASS | not needed | Anchor and diagnostic oracle passed. |
| P1 | `session.switch-restore-runtime-cache` | PASS | not needed | Restored feed without visible feed pollution. |
| P2 | `edge.custom-scrollbar-drag-top` | PASS | not needed | `needMoreBefore` stayed within bound. |
| P2 | `edge.custom-scrollbar-drag-bottom` | PASS | not needed | `needMoreAfter` stayed within bound. |
| P2 | `lifecycle.strictmode-attach-detach-attach` | FAIL | FAIL | Oracle failed because `observedRows` was `0` after reattach. |
| P2 | `recovery.bootstrap-commit-timeout` | FAIL | FAIL | Expected `commit-timeout-bootstrap` viewport error was not observed. |
| P3 | `storm.quote-jump-during-event-storm` | FAIL | FAIL | `toggle_event_storm` timed out with `pendingOperation=mock.eventStorm`. |
| P3 | `storm.follow-bottom-with-bot-push` | FAIL | FAIL | `toggle_bot_push` timed out with `pendingOperation=mock.botPush`. |
| P3 | `storm.dynamic-height-session-switch` | PASS | not needed | No white screen, runtime idle, no feed pollution. |

## Failure Analysis

### `destination.quote-jump-visible-target`

Failure point: action `jump_to_quoted_message`.

Evidence:

- Runtime stayed `READY/READY_IDLE`.
- Transaction stayed `idle`.
- Bottom lock stayed `UNLOCKED`.
- Visible range stayed `feed-runtime-m-71..feed-runtime-m-72`.
- Console errors: `0`.
- Viewport errors: none.
- Destination settled events: `0`.
- Failure code: `missing_visible_quote`.

Interpretation:

This is primarily a scenario precondition / action-contract gap. The current
seed plus `scroll_to_middle` does not guarantee that a visible row contains a
`data-ai-action="jump-to-quote"` target. No runtime failure is evidenced by this
run.

### `lifecycle.strictmode-attach-detach-attach`

Failure point: oracle `expectRuntimeAttachedOnce`.

Evidence:

- Runtime ended `READY/READY_IDLE`.
- Transaction ended `idle`.
- Bottom lock ended `LOCKED`.
- Rendered rows: `20`.
- Visible rows: `feed-runtime-m-79..feed-runtime-m-80`.
- Height cache size: `20`.
- `observedRows`: `0`.
- Console errors: `0`.
- Viewport errors: none.

Interpretation:

This is a real evidence mismatch after detach/attach. The list is visibly
rendered and idle, but the runtime debug snapshot reports no observed rows. The
current evidence cannot distinguish whether the issue is runtime observer
reattach, React ref registration timing, or an oracle/wait condition that samples
before observer registration has recovered.

### `recovery.bootstrap-commit-timeout`

Failure point: oracle `expectViewportErrorObserved`.

Evidence:

- Runtime ended `READY/READY_IDLE`.
- Transaction ended `idle`.
- Bottom lock ended `LOCKED`.
- Rendered rows: `20`.
- Visible rows: `feed-runtime-m-79..feed-runtime-m-80`.
- Viewport errors: none.
- Expected viewport error: `commit-timeout-bootstrap`.

Interpretation:

This looks like a scenario injection gap. The scenario expects a bootstrap commit
timeout signal, but this run never produced that failure condition. The host
bootstrapped normally and the recovery oracle had no error evidence to consume.

### `storm.quote-jump-during-event-storm`

Failure point: action `toggle_event_storm`.

Evidence:

- Runtime ended `READY/READY_IDLE`.
- Transaction ended `idle`.
- Bottom lock ended `LOCKED`.
- Pending operation after action: `mock.eventStorm`.
- Console errors: `0`.
- Viewport errors: none.
- Failure code: `toggle_event_storm_timeout`.

Interpretation:

This is primarily an e2e action-contract issue. `toggle_event_storm` starts a
long-running mock stream, but `runAction()` waits for `pendingOperation` to
return to `idle`. Because the storm remains active by design, the scenario times
out before it can execute the quote-jump step.

### `storm.follow-bottom-with-bot-push`

Failure point: action `toggle_bot_push`.

Evidence:

- Runtime ended `READY/READY_IDLE`.
- Transaction ended `idle`.
- Bottom lock stayed `UNLOCKED`.
- Pending operation after action: `mock.botPush`.
- Console errors: `0`.
- Viewport errors: none.
- Failure code: `toggle_bot_push_timeout`.

Interpretation:

This has the same shape as the event-storm failure. `toggle_bot_push` starts a
long-running mock stream, but the e2e action waits for a fully idle UI state.
The scenario cannot progress to `follow_bottom` while the mock stream is active.

## Conclusions

The P0 gate is usable: the three canonical IM smoke scenarios passed in a real
browser through the bridge, evidence, and deterministic oracle path.

The full roadmap matrix is not green. The current failures are not random; all
five failed scenarios reproduced on retry.

The failures are concentrated in scenario/action contract maturity rather than
basic runtime boot. In particular:

- P1 quote-jump needs a deterministic visible quote precondition or a semantic
  action that selects a known quote target.
- P2 recovery needs an actual commit-timeout fault injection path before the
  oracle can be meaningful.
- P2 lifecycle needs either a stronger wait condition for observer reattach or a
  runtime/React fix if `observedRows=0` is genuinely invalid after reattach.
- P3 long-running mock actions need start/stop semantics that do not require
  `pendingOperation=idle` immediately after activation.

Ordinary demo pollution was not observed at build level: `npm run build:demo`
passed after the e2e run.
