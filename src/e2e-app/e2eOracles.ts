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

export type NoUnexpectedErrorsOptions = {
  allowedViewportErrors?: string[]
}

export type NeedMessagesAroundOptions = {
  reason?: string
  messageId?: string
}

export type VisibleOptimisticRowOptions = {
  status?: 'sending' | 'failed'
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

export function expectNoUnexpectedErrors(
  evidence: E2EEvidence,
  options: NoUnexpectedErrorsOptions = {},
): E2EOracleResult {
  const allowedViewportErrors = new Set(options.allowedViewportErrors ?? [])
  const unexpectedViewportErrors = evidence.events.viewportErrors.filter(
    (error) => !allowedViewportErrors.has(error),
  )
  const failures: string[] = []

  if (evidence.console.errors.length > 0) {
    failures.push(`console errors is ${evidence.console.errors.length}`)
  }

  if (unexpectedViewportErrors.length > 0) {
    failures.push(`viewport errors: ${unexpectedViewportErrors.join(', ')}`)
  }

  return failures.length === 0
    ? pass('expectNoUnexpectedErrors', 'no unexpected errors observed')
    : fail('expectNoUnexpectedErrors', 'unexpected errors observed', {
        failures,
        consoleErrors: evidence.console.errors,
        viewportErrors: evidence.events.viewportErrors,
        allowedViewportErrors: [...allowedViewportErrors],
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

export function expectVisibleOptimisticRow(
  evidence: E2EEvidence,
  options: VisibleOptimisticRowOptions = {},
): E2EOracleResult {
  const optimisticRows = evidence.viewport.visibleRows.filter((row) => {
    if (row.itemKind !== 'optimistic') {
      return false
    }

    return !options.status || row.optimisticStatus === options.status
  })

  return optimisticRows.length > 0
    ? pass('expectVisibleOptimisticRow', 'visible optimistic row observed')
    : fail('expectVisibleOptimisticRow', 'visible optimistic row missing', {
        expectedStatus: options.status,
        visibleRows: evidence.viewport.visibleRows,
      })
}

export function expectNoOptimisticRows(
  evidence: E2EEvidence,
): E2EOracleResult {
  const optimisticRows = evidence.viewport.visibleRows.filter(
    (row) => row.itemKind === 'optimistic',
  )

  return optimisticRows.length === 0
    ? pass('expectNoOptimisticRows', 'no visible optimistic rows remain')
    : fail('expectNoOptimisticRows', 'optimistic rows still visible', {
        optimisticRows,
      })
}

export function expectSameVisibleOptimisticKey(
  before: E2EEvidence,
  after: E2EEvidence,
): E2EOracleResult {
  const beforeKey = before.viewport.visibleRows.find(
    (row) => row.itemKind === 'optimistic',
  )?.serializedKey
  const afterKey = after.viewport.visibleRows.find(
    (row) => row.itemKind === 'optimistic',
  )?.serializedKey
  const failures: string[] = []

  if (!beforeKey) {
    failures.push('before optimistic row is missing')
  }

  if (!afterKey) {
    failures.push('after optimistic row is missing')
  }

  if (beforeKey && afterKey && beforeKey !== afterKey) {
    failures.push(`optimistic key changed from ${beforeKey} to ${afterKey}`)
  }

  return failures.length === 0
    ? pass('expectSameVisibleOptimisticKey', 'visible optimistic key is stable')
    : fail('expectSameVisibleOptimisticKey', 'visible optimistic key changed', {
        failures,
        beforeKey,
        afterKey,
      })
}

export function expectNoCommittedRowsBeyondFeedMessageCount(
  evidence: E2EEvidence,
): E2EOracleResult {
  const activeFeedPrefix = `${evidence.feed.activeFeedId}-m-`
  const extraCommittedRows = evidence.viewport.visibleRows.filter((row) => {
    if (row.itemKind !== 'committed' || !row.messageId.startsWith(activeFeedPrefix)) {
      return false
    }

    const sequence = Number(row.messageId.slice(activeFeedPrefix.length))
    return Number.isFinite(sequence) && sequence > evidence.feed.messageCount
  })

  return extraCommittedRows.length === 0
    ? pass(
        'expectNoCommittedRowsBeyondFeedMessageCount',
        'no committed row beyond feed count observed',
      )
    : fail(
        'expectNoCommittedRowsBeyondFeedMessageCount',
        'committed row appeared before ack',
        {
          messageCount: evidence.feed.messageCount,
          extraCommittedRows,
        },
      )
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

export function expectDestinationFallbackDeleted(
  evidence: E2EEvidence,
): E2EOracleResult {
  const settled = evidence.events.destinationSettled.at(-1)
  const visibleIds = evidence.viewport.visibleRows.map((row) => row.messageId)
  const failures: string[] = []

  if (!settled) {
    failures.push('destinationSettled event is missing')
  }

  if (settled && settled.resolution !== 'fallback-deleted') {
    failures.push(`resolution is ${settled.resolution ?? 'missing'}`)
  }

  if (settled?.targetMessageId && settled.resolvedMessageId) {
    if (settled.targetMessageId === settled.resolvedMessageId) {
      failures.push('resolved target did not fallback to a different message')
    }
  }

  if (!settled?.resolvedMessageId) {
    failures.push('resolved fallback target is missing')
  } else if (!visibleIds.includes(settled.resolvedMessageId)) {
    failures.push(`resolved fallback ${settled.resolvedMessageId} is not visible`)
  }

  if (evidence.ui.highlightedMessageId !== null) {
    failures.push(`highlight is ${evidence.ui.highlightedMessageId}`)
  }

  if (evidence.runtime.destinationState !== 'settled') {
    failures.push(`destination state is ${evidence.runtime.destinationState}`)
  }

  return failures.length === 0
    ? pass(
        'expectDestinationFallbackDeleted',
        'destination settled on deleted-target fallback',
      )
    : fail(
        'expectDestinationFallbackDeleted',
        'destination deleted-target fallback failed',
        {
          failures,
          settled,
          visibleIds,
          highlightedMessageId: evidence.ui.highlightedMessageId,
        },
      )
}

export function expectNeedMessagesAroundObserved(
  evidence: E2EEvidence,
  options: NeedMessagesAroundOptions = {},
): E2EOracleResult {
  const matched = evidence.events.needMessagesAround.some((event) => {
    if (options.reason && event.reason !== options.reason) {
      return false
    }

    if (options.messageId && event.messageId !== options.messageId) {
      return false
    }

    return true
  })

  return matched
    ? pass('expectNeedMessagesAroundObserved', 'needMessagesAround observed')
    : fail('expectNeedMessagesAroundObserved', 'needMessagesAround missing', {
        expected: options,
        needMessagesAround: evidence.events.needMessagesAround,
      })
}

export function expectLoadedMessageCountDelta(
  before: E2EEvidence,
  after: E2EEvidence,
  expectedDelta: number,
): E2EOracleResult {
  const actualDelta =
    after.feed.loadedMessageCount - before.feed.loadedMessageCount

  return actualDelta === expectedDelta
    ? pass('expectLoadedMessageCountDelta', 'loaded message count delta matched')
    : fail(
        'expectLoadedMessageCountDelta',
        'loaded message count delta did not match',
        {
          actualDelta,
          expectedDelta,
          beforeLoadedMessageCount: before.feed.loadedMessageCount,
          afterLoadedMessageCount: after.feed.loadedMessageCount,
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

export function expectActiveFeed(
  evidence: E2EEvidence,
  expectedFeedId: string,
): E2EOracleResult {
  return evidence.feed.activeFeedId === expectedFeedId
    ? pass('expectActiveFeed', 'active feed matched')
    : fail('expectActiveFeed', 'active feed did not match', {
        expectedFeedId,
        activeFeedId: evidence.feed.activeFeedId,
      })
}

export function expectVisibleRowsBelongToActiveFeed(
  evidence: E2EEvidence,
): E2EOracleResult {
  const activeFeedId = evidence.feed.activeFeedId
  const pollutedVisibleIds = evidence.viewport.visibleRows
    .filter((row) => row.itemKind === 'committed')
    .map((row) => row.messageId)
    .filter((messageId) => !messageId.startsWith(`${activeFeedId}-`))

  return pollutedVisibleIds.length === 0
    ? pass(
        'expectVisibleRowsBelongToActiveFeed',
        'visible rows belong to active feed',
      )
    : fail(
        'expectVisibleRowsBelongToActiveFeed',
        'visible rows include another feed',
        {
          activeFeedId,
          pollutedVisibleIds,
        },
      )
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

export function expectNoWhiteScreen(evidence: E2EEvidence): E2EOracleResult {
  const failures: string[] = []

  if (evidence.viewport.renderedRows <= 0) {
    failures.push(`rendered rows is ${evidence.viewport.renderedRows}`)
  }

  if (evidence.console.errors.length > 0) {
    failures.push(`console errors is ${evidence.console.errors.length}`)
  }

  return failures.length === 0
    ? pass('expectNoWhiteScreen', 'message list has rendered rows')
    : fail('expectNoWhiteScreen', 'message list is blank or errored', {
        failures,
      })
}

export function expectDestinationOutcomeRecorded(
  evidence: E2EEvidence,
): E2EOracleResult {
  const hasSettled = evidence.events.destinationSettled.length > 0
  const hasCancelDiagnostic = evidence.diagnostics.recent.some(
    (record) => record.name.startsWith('destinationMotion.cancel'),
  )
  const hasViewportError = evidence.events.viewportErrors.length > 0

  return hasSettled || hasCancelDiagnostic || hasViewportError
    ? pass('expectDestinationOutcomeRecorded', 'destination outcome is recorded')
    : fail(
        'expectDestinationOutcomeRecorded',
        'destination outcome evidence is missing',
        {
          destinationSettled: evidence.events.destinationSettled,
          viewportErrors: evidence.events.viewportErrors,
        },
      )
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
