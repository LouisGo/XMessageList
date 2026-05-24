import type { E2EEvidence } from './e2eBridge'

export type E2EOracleResult = {
  ok: boolean
  oracleId: string
  message: string
  details?: Record<string, unknown>
}

export type AnchorPreservedOptions = {
  tolerancePx?: number
}

export type BottomLockedOptions = {
  thresholdPx?: number
}

export function expectRuntimeIdle(evidence: E2EEvidence): E2EOracleResult {
  const failures: string[] = []

  if (evidence.runtime.state !== 'READY' && evidence.runtime.state !== 'READY_EMPTY') {
    failures.push(`runtime state is ${evidence.runtime.state}`)
  }

  if (evidence.runtime.transactionState !== 'idle') {
    failures.push(`transaction state is ${evidence.runtime.transactionState}`)
  }

  if (
    evidence.runtime.destinationState !== 'idle' &&
    evidence.runtime.destinationState !== 'settled'
  ) {
    failures.push(`destination state is ${evidence.runtime.destinationState}`)
  }

  if (evidence.runtime.motionActive) {
    failures.push('motion is active')
  }

  if (evidence.runtime.pendingCommands !== 0) {
    failures.push(`pending commands is ${evidence.runtime.pendingCommands}`)
  }

  return failures.length === 0
    ? pass('expectRuntimeIdle', 'runtime is idle')
    : fail('expectRuntimeIdle', 'runtime is not idle', {
        failures,
        runtime: evidence.runtime,
      })
}

export function expectBottomLocked(
  evidence: E2EEvidence,
  options: BottomLockedOptions = {},
): E2EOracleResult {
  const thresholdPx = options.thresholdPx ?? 1
  const failures: string[] = []

  if (evidence.runtime.bottomLockState !== 'LOCKED') {
    failures.push(`bottom lock is ${evidence.runtime.bottomLockState}`)
  }

  if (evidence.viewport.distanceToBottom > thresholdPx) {
    failures.push(
      `distance to bottom ${evidence.viewport.distanceToBottom} exceeds ${thresholdPx}`,
    )
  }

  if (evidence.ui.followBottomVisible) {
    failures.push('follow bottom affordance is visible')
  }

  return failures.length === 0
    ? pass('expectBottomLocked', 'viewport is locked to bottom')
    : fail('expectBottomLocked', 'viewport is not locked to bottom', {
        failures,
        thresholdPx,
        distanceToBottom: evidence.viewport.distanceToBottom,
      })
}

export function expectAnchorPreserved(
  before: E2EEvidence,
  after: E2EEvidence,
  options: AnchorPreservedOptions = {},
): E2EOracleResult {
  const tolerancePx = options.tolerancePx ?? 1
  const beforeAnchor = before.anchors.current
  const afterAnchor = after.anchors.current
  const failures: string[] = []

  if (!beforeAnchor) {
    failures.push('before anchor is missing')
  }

  if (!afterAnchor) {
    failures.push('after anchor is missing')
  }

  if (
    beforeAnchor &&
    afterAnchor &&
    beforeAnchor.messageId !== afterAnchor.messageId
  ) {
    failures.push(
      `anchor changed from ${beforeAnchor.messageId} to ${afterAnchor.messageId}`,
    )
  }

  const deltaPx = beforeAnchor && afterAnchor
    ? afterAnchor.top - beforeAnchor.top
    : null

  if (deltaPx !== null && Math.abs(deltaPx) > tolerancePx) {
    failures.push(`anchor delta ${deltaPx} exceeds ${tolerancePx}`)
  }

  if (after.events.viewportErrors.length > 0) {
    failures.push(`viewport errors: ${after.events.viewportErrors.join(', ')}`)
  }

  return failures.length === 0
    ? pass('expectAnchorPreserved', 'anchor is preserved')
    : fail('expectAnchorPreserved', 'anchor is not preserved', {
        failures,
        tolerancePx,
        deltaPx,
      })
}

export function expectNoFollowWhenUserReading(
  before: E2EEvidence,
  after: E2EEvidence,
): E2EOracleResult {
  const failures: string[] = []
  const beforeAnchorId = before.anchors.current?.messageId ??
    before.viewport.visibleRows[0]?.messageId ??
    null
  const afterVisibleIds = after.viewport.visibleRows.map((row) => row.messageId)

  if (after.runtime.bottomLockState !== 'UNLOCKED') {
    failures.push(`bottom lock is ${after.runtime.bottomLockState}`)
  }

  if (after.viewport.distanceToBottom <= 1) {
    failures.push(`distance to bottom is ${after.viewport.distanceToBottom}`)
  }

  if (!beforeAnchorId) {
    failures.push('before reading anchor is missing')
  } else if (!afterVisibleIds.includes(beforeAnchorId)) {
    failures.push(`before anchor ${beforeAnchorId} is no longer visible`)
  }

  if (after.events.viewportErrors.length > 0) {
    failures.push(`viewport errors: ${after.events.viewportErrors.join(', ')}`)
  }

  return failures.length === 0
    ? pass('expectNoFollowWhenUserReading', 'user reading position was not stolen')
    : fail(
        'expectNoFollowWhenUserReading',
        'user reading position was stolen or became unprovable',
        {
          failures,
          beforeAnchorId,
          afterVisibleIds,
          distanceToBottom: after.viewport.distanceToBottom,
        },
      )
}

export function expectLatestMessageVisible(
  evidence: E2EEvidence,
): E2EOracleResult {
  const latestMessageId = `${evidence.feed.activeFeedId}-m-${evidence.feed.messageCount}`
  const visibleIds = evidence.viewport.visibleRows.map((row) => row.messageId)

  return visibleIds.includes(latestMessageId)
    ? pass('expectLatestMessageVisible', 'latest message is visible')
    : fail('expectLatestMessageVisible', 'latest message is not visible', {
        latestMessageId,
        visibleIds,
      })
}

export function expectDestinationSettledOnTarget(
  evidence: E2EEvidence,
): E2EOracleResult {
  const settled = evidence.events.destinationSettled.at(-1)
  const failures: string[] = []

  if (!settled) {
    failures.push('destinationSettled event is missing')
  }

  const resolvedMessageId = settled?.resolvedMessageId ?? settled?.targetMessageId
  const visibleIds = evidence.viewport.visibleRows.map((row) => row.messageId)

  if (resolvedMessageId && !visibleIds.includes(resolvedMessageId)) {
    failures.push(`resolved target ${resolvedMessageId} is not visible`)
  }

  if (
    resolvedMessageId &&
    settled?.resolution !== 'fallback-deleted' &&
    evidence.ui.highlightedMessageId !== resolvedMessageId
  ) {
    failures.push(
      `highlight ${evidence.ui.highlightedMessageId ?? 'none'} does not match ${resolvedMessageId}`,
    )
  }

  if (evidence.runtime.destinationState !== 'settled') {
    failures.push(`destination state is ${evidence.runtime.destinationState}`)
  }

  return failures.length === 0
    ? pass('expectDestinationSettledOnTarget', 'destination settled on target')
    : fail(
        'expectDestinationSettledOnTarget',
        'destination did not settle on target',
        {
          failures,
          settled,
          visibleIds,
          highlightedMessageId: evidence.ui.highlightedMessageId,
        },
      )
}

export function expectDiagnosticObserved(
  evidence: E2EEvidence,
  diagnosticName: string,
): E2EOracleResult {
  const matched = evidence.diagnostics.recent.some((record) =>
    record.name === diagnosticName || record.name.startsWith(`${diagnosticName}.`),
  )

  return matched
    ? pass('expectDiagnosticObserved', `diagnostic ${diagnosticName} observed`)
    : fail('expectDiagnosticObserved', `diagnostic ${diagnosticName} missing`, {
        diagnosticName,
        recentNames: evidence.diagnostics.recent.map((record) => record.name),
      })
}

export function expectNoFeedPollution(
  before: E2EEvidence,
  after: E2EEvidence,
): E2EOracleResult {
  const failures: string[] = []
  const activeFeedId = after.feed.activeFeedId
  const pollutedVisibleIds = after.viewport.visibleRows
    .map((row) => row.messageId)
    .filter((messageId) => !messageId.startsWith(`${activeFeedId}-`))

  if (before.feed.activeFeedId !== after.feed.activeFeedId) {
    failures.push(
      `active feed changed from ${before.feed.activeFeedId} to ${after.feed.activeFeedId}`,
    )
  }

  if (pollutedVisibleIds.length > 0) {
    failures.push(`visible rows include foreign feed ids: ${pollutedVisibleIds.join(', ')}`)
  }

  return failures.length === 0
    ? pass('expectNoFeedPollution', 'visible rows belong to the restored feed')
    : fail('expectNoFeedPollution', 'feed pollution detected', {
        failures,
        activeFeedId,
        pollutedVisibleIds,
      })
}

export function expectNeedMoreBeforeWithin(
  evidence: E2EEvidence,
  maxCount: number,
): E2EOracleResult {
  return evidence.events.needMoreBefore <= maxCount
    ? pass('expectNeedMoreBeforeWithin', 'needMoreBefore count is bounded')
    : fail('expectNeedMoreBeforeWithin', 'needMoreBefore repeated unexpectedly', {
        actual: evidence.events.needMoreBefore,
        maxCount,
      })
}

export function expectNeedMoreAfterWithin(
  evidence: E2EEvidence,
  maxCount: number,
): E2EOracleResult {
  return evidence.events.needMoreAfter <= maxCount
    ? pass('expectNeedMoreAfterWithin', 'needMoreAfter count is bounded')
    : fail('expectNeedMoreAfterWithin', 'needMoreAfter repeated unexpectedly', {
        actual: evidence.events.needMoreAfter,
        maxCount,
      })
}

export function expectRuntimeAttachedOnce(evidence: E2EEvidence): E2EOracleResult {
  const failures: string[] = []

  if (evidence.runtime.observedRows <= 0) {
    failures.push(`observed rows is ${evidence.runtime.observedRows}`)
  }

  if (evidence.console.errors.length > 0) {
    failures.push(`console errors is ${evidence.console.errors.length}`)
  }

  if (evidence.events.viewportErrors.length > 0) {
    failures.push(`viewport errors: ${evidence.events.viewportErrors.join(', ')}`)
  }

  return failures.length === 0
    ? pass('expectRuntimeAttachedOnce', 'runtime is attached with observed rows')
    : fail('expectRuntimeAttachedOnce', 'runtime attach state is unhealthy', {
        failures,
      })
}

export function expectViewportErrorObserved(
  evidence: E2EEvidence,
  code: string,
): E2EOracleResult {
  return evidence.events.viewportErrors.includes(code)
    ? pass('expectViewportErrorObserved', `viewport error ${code} observed`)
    : fail('expectViewportErrorObserved', `viewport error ${code} missing`, {
        code,
        viewportErrors: evidence.events.viewportErrors,
      })
}

function pass(oracleId: string, message: string): E2EOracleResult {
  return {
    ok: true,
    oracleId,
    message,
  }
}

function fail(
  oracleId: string,
  message: string,
  details?: Record<string, unknown>,
): E2EOracleResult {
  return {
    ok: false,
    oracleId,
    message,
    details,
  }
}
