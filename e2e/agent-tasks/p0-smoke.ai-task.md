# P0 Smoke AI Task

Priority: P0
Scope: XMessageList AI-first e2e host
Target: `/e2e`

## Goal

Verify the minimum IM message-list contract without guessing DOM structure:

1. latest bootstrap reaches bottom lock;
2. prepending history preserves the reading anchor;
3. appending while the user reads history does not steal scroll position.

## Required Scenarios

Run these scenarios in order:

1. `bootstrap.latest-bottom-lock`
2. `paging.prepend-anchor-preservation`
3. `bottom.user-scroll-up-append-no-follow`

Do not expand into P1/P2/P3 scenarios for this task.

## Allowed Bridge Calls

Use `window.__X_MESSAGE_LIST_E2E__` version `1`.

Allowed methods:

- `getState()`
- `listActions()`
- `runAction(actionId, payload)`
- `getEvidence()`
- `resetScenario(scenarioId)`

Allowed actions:

- `wait_for_ready`
- `wait_for_idle`
- `collect_evidence`
- `scroll_to_middle`
- `scroll_to_history_top`
- `scroll_to_bottom`
- `append_message`
- `prepend_history`
- `follow_bottom`

Do not set DOM `scrollTop` directly. Use bridge actions or public semantic DOM controls only.

## Scenario Action Sequences

### `bootstrap.latest-bottom-lock`

1. Open `/e2e?scenario=bootstrap.latest-bottom-lock`.
2. Call `getState()` and verify bridge version is `1`.
3. Call `resetScenario('bootstrap.latest-bottom-lock')`.
4. Call `runAction('wait_for_ready')`.
5. Call `runAction('collect_evidence', { checkpointId: 'final' })`.
6. Save the `after` evidence as the final checkpoint.

Success oracle:

- `expectRuntimeIdle(final)`
- `expectBottomLocked(final, { thresholdPx: 1 })`

### `paging.prepend-anchor-preservation`

1. Open `/e2e?scenario=paging.prepend-anchor-preservation`.
2. Call `getState()` and verify bridge version is `1`.
3. Call `resetScenario('paging.prepend-anchor-preservation')`.
4. Call `runAction('wait_for_ready')`.
5. Call `runAction('scroll_to_middle')`.
6. Call `runAction('collect_evidence', { checkpointId: 'before' })`.
7. Call `runAction('prepend_history')`.
8. Call `runAction('wait_for_idle')`.
9. Call `runAction('collect_evidence', { checkpointId: 'after' })`.
10. Save `before` and `after` evidence.

Success oracle:

- `expectRuntimeIdle(after)`
- `expectAnchorPreserved(before, after, { tolerancePx: 1 })`

### `bottom.user-scroll-up-append-no-follow`

1. Open `/e2e?scenario=bottom.user-scroll-up-append-no-follow`.
2. Call `getState()` and verify bridge version is `1`.
3. Call `resetScenario('bottom.user-scroll-up-append-no-follow')`.
4. Call `runAction('wait_for_ready')`.
5. Call `runAction('scroll_to_middle')`.
6. Call `runAction('collect_evidence', { checkpointId: 'before' })`.
7. Call `runAction('append_message')`.
8. Call `runAction('wait_for_idle')`.
9. Call `runAction('collect_evidence', { checkpointId: 'after' })`.
10. Save `before` and `after` evidence.

Success oracle:

- `expectRuntimeIdle(after)`
- `expectNoFollowWhenUserReading(before, after)`

## Evidence Requirements

For every scenario, save or report:

- scenario id;
- action results;
- final `getState()`;
- required evidence checkpoints;
- console error and warning counts;
- viewport errors;
- failed oracle ids, if any.

If evidence is missing, report the missing field instead of guessing a root cause.

## Output Format

Return one concise result block per scenario:

```text
PASS|FAIL <scenario-id>
actions: <completed>/<total>
oracles: <passed>/<total>
primary owner: <demo|react|runtime|browser|harness|unknown|none>
evidence: <saved path, pasted JSON summary, or unavailable>
notes: <only evidence-backed facts>
```

## Shortest Repro Workflow

When a scenario fails:

1. Stop expanding to other scenarios unless the task explicitly asks for full P0 continuation.
2. Preserve the failing scenario id and exact action sequence.
3. Keep the smallest prefix ending at the first failed action or oracle.
4. Include the `before` and `after` evidence for the failing step.
5. Include generated markdown failure report if available.
6. State which evidence field is missing if the owner cannot be classified.
