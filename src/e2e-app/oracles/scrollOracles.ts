import type { E2EEvidence } from '../bridge/e2eBridge.ts'
import {
  findFirstCommonVisibleRow,
  findRemapRow,
  firstIdentityRemap,
} from './oracleHelpers.ts'
import type { E2EOracleResult } from './oracleResult.ts'

export function expectBottomLocked(
  evidence: E2EEvidence,
  options: { thresholdPx: number },
): E2EOracleResult {
  const distance = Math.abs(
    evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop,
  )
  return {
    oracleId: 'bottom-locked',
    ok: evidence.bottomLockState === 'LOCKED' &&
      !evidence.hasMoreAfter &&
      distance <= options.thresholdPx,
    message: `lock=${evidence.bottomLockState} hasMoreAfter=${evidence.hasMoreAfter} distance=${distance}`,
  }
}

export function expectAnchorPreserved(
  before: E2EEvidence,
  after: E2EEvidence,
  options: { tolerancePx: number },
): E2EOracleResult {
  const match = findFirstCommonVisibleRow(before, after)
  const delta = match
    ? Math.abs(match.before.top - match.after.top)
    : Number.POSITIVE_INFINITY

  return {
    oracleId: 'anchor-preserved',
    ok: Boolean(match) && delta <= options.tolerancePx,
    message: match
      ? `key=${match.key} delta=${delta}`
      : 'no common visible row',
  }
}

export function expectScrollHeightIncreased(
  before: E2EEvidence,
  after: E2EEvidence,
): E2EOracleResult {
  return {
    oracleId: 'scroll-height-increased',
    ok: after.scrollHeight > before.scrollHeight,
    message: `before=${before.scrollHeight} after=${after.scrollHeight}`,
  }
}

export function expectScrollTopIncreased(
  before: E2EEvidence,
  after: E2EEvidence,
): E2EOracleResult {
  return {
    oracleId: 'scroll-top-increased',
    ok: after.scrollTop > before.scrollTop,
    message: `before=${before.scrollTop} after=${after.scrollTop}`,
  }
}

export function expectNoFollowWhenUserReading(
  before: E2EEvidence,
  after: E2EEvidence,
): E2EOracleResult {
  const maxDelta = Math.max(2, before.clientHeight * 0.1)
  const delta = Math.abs(after.scrollTop - before.scrollTop)

  return {
    oracleId: 'no-follow-while-reading',
    ok: after.bottomLockState === 'UNLOCKED' && delta <= maxDelta,
    message: `lock=${after.bottomLockState} delta=${delta} max=${maxDelta}`,
  }
}

export function expectVisibleIdentity(
  evidence: E2EEvidence,
  stableId: string,
): E2EOracleResult {
  const visible = evidence.visibleRows.some((row) =>
    row.stableId === stableId || row.serverId === stableId || row.key === stableId
  )

  return {
    oracleId: 'visible-identity',
    ok: visible,
    message: `stableId=${stableId} visible=${visible}`,
  }
}

export function expectVisibleIdentityNearCenter(
  evidence: E2EEvidence,
  stableId: string,
  options: { tolerancePx: number },
): E2EOracleResult {
  const row = evidence.visibleRows.find((candidate) =>
    candidate.stableId === stableId ||
    candidate.serverId === stableId ||
    candidate.key === stableId
  )
  const rowCenter = row ? (row.top + row.bottom) / 2 : Number.NaN
  const viewportCenter = evidence.scrollContainerTop + evidence.clientHeight / 2
  const delta = Math.abs(rowCenter - viewportCenter)

  return {
    oracleId: 'visible-identity-near-center',
    ok: Boolean(row) && delta <= options.tolerancePx,
    message: row
      ? `stableId=${stableId} delta=${delta}`
      : `stableId=${stableId} visible=false`,
  }
}

export function expectRemappedAnchorPreserved(
  before: E2EEvidence,
  after: E2EEvidence,
  options: { tolerancePx: number },
): E2EOracleResult {
  const remap = firstIdentityRemap(after)
  const beforeRow = remap
    ? findRemapRow(before, remap.previousKey, remap.from)
    : null
  const afterRow = remap
    ? findRemapRow(after, remap.nextKey, remap.to)
    : null
  const delta = beforeRow && afterRow
    ? Math.abs(beforeRow.top - afterRow.top)
    : Number.POSITIVE_INFINITY

  return {
    oracleId: 'identity-remap-anchor-preserved',
    ok: Boolean(beforeRow && afterRow) && delta <= options.tolerancePx,
    message: beforeRow && afterRow
      ? `previousKey=${remap?.previousKey} nextKey=${remap?.nextKey} delta=${delta}`
      : `beforeRow=${beforeRow ? 'yes' : 'no'} afterRow=${afterRow ? 'yes' : 'no'}`,
  }
}

export function expectScrollHeightUnchanged(
  before: E2EEvidence,
  after: E2EEvidence,
  options: { tolerancePx: number },
): E2EOracleResult {
  const delta = Math.abs(after.scrollHeight - before.scrollHeight)

  return {
    oracleId: 'scroll-height-unchanged',
    ok: delta <= options.tolerancePx,
    message: `before=${before.scrollHeight} after=${after.scrollHeight} delta=${delta}`,
  }
}

export function expectLocalAlignWithoutAround(
  before: E2EEvidence,
  after: E2EEvidence,
): E2EOracleResult {
  const aroundBefore = before.events.filter((event) =>
    event.type === 'needMessagesAround'
  ).length
  const aroundAfter = after.events.filter((event) =>
    event.type === 'needMessagesAround'
  ).length

  return {
    oracleId: 'local-align-without-around',
    ok: aroundAfter === aroundBefore && after.visibleRows.length > 0,
    message: `aroundBefore=${aroundBefore} aroundAfter=${aroundAfter}`,
  }
}
