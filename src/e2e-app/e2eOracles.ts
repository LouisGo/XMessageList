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
