import type { E2EEvidence } from './e2eBridge'

export type E2EOracleResult = {
  oracleId: string
  ok: boolean
  message: string
}

export type E2EOracle = () => E2EOracleResult

export function expectRuntimeIdle(evidence: E2EEvidence): E2EOracleResult {
  return {
    oracleId: 'runtime-idle',
    ok: evidence.phase === 'IDLE' && evidence.pendingIntent === null,
    message: `phase=${evidence.phase} pending=${evidence.pendingIntent}`,
  }
}

export function expectNoWhiteScreen(evidence: E2EEvidence): E2EOracleResult {
  return {
    oracleId: 'no-white-screen',
    ok: evidence.visibleRows.length > 0 && evidence.scrollHeight > 0,
    message: `visibleRows=${evidence.visibleRows.length} scrollHeight=${evidence.scrollHeight}`,
  }
}

export function expectNoSpacerEvidence(evidence: E2EEvidence): E2EOracleResult {
  const hasSpacerField = Object.keys(evidence).some((key) =>
    key.toLowerCase().includes('spacer')
  )

  return {
    oracleId: 'no-spacer-evidence',
    ok: !hasSpacerField,
    message: hasSpacerField ? 'spacer field present' : 'no spacer fields',
  }
}

export function expectEvidenceContract(evidence: E2EEvidence): E2EOracleResult {
  const token = evidence.commitToken
  const segment = evidence.segment
  const ok = evidence.schemaVersion === 2 &&
    Boolean(token) &&
    segment.itemCount > 0 &&
    segment.firstKey !== null &&
    segment.lastKey !== null &&
    typeof evidence.generation === 'number' &&
    typeof evidence.segmentRevision === 'number' &&
    typeof evidence.projectionRevision === 'number'

  return {
    oracleId: 'evidence-contract',
    ok,
    message: `schema=${evidence.schemaVersion} items=${segment.itemCount} token=${token ? 'yes' : 'no'}`,
  }
}

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

export function expectNeedEventCount(
  evidence: E2EEvidence,
  type: 'needMoreBefore' | 'needMoreAfter' | 'needLatestMessages' | 'needMessagesAround',
  count: number,
): E2EOracleResult {
  const actual = evidence.events.filter((event) => event.type === type).length

  return {
    oracleId: `${type}-count`,
    ok: actual === count,
    message: `expected=${count} actual=${actual}`,
  }
}

export function expectNoViewportErrors(evidence: E2EEvidence): E2EOracleResult {
  const errors = evidence.events.filter((event) => event.type === 'viewportError')

  return {
    oracleId: 'no-viewport-errors',
    ok: errors.length === 0,
    message: `viewportErrors=${errors.length}`,
  }
}

export function expectUnderflowSingleFlight(evidence: E2EEvidence): E2EOracleResult {
  const needs = evidence.events.filter((event) =>
    event.type === 'needMoreBefore' || event.type === 'needMoreAfter'
  )
  const byRevision = new Map<string, Set<string>>()

  for (const event of needs) {
    const key = `${event.generation}:${event.segmentRevision}`
    const edges = byRevision.get(key) ?? new Set<string>()
    if (event.edge) {
      edges.add(event.edge)
    }
    byRevision.set(key, edges)
  }

  const violating = Array.from(byRevision.values()).some((edges) => edges.size > 1)

  return {
    oracleId: 'underflow-single-flight',
    ok: !violating,
    message: `revisionBuckets=${byRevision.size}`,
  }
}

export function expectModifier(
  evidence: E2EEvidence,
  modifier: string,
): E2EOracleResult {
  return {
    oracleId: `modifier-${modifier}`,
    ok: evidence.segment.modifier.type === modifier || evidence.modifier === modifier,
    message: `modifier=${evidence.segment.modifier.type}`,
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

export function expectIdentityRemapModifierContract(
  evidence: E2EEvidence,
): E2EOracleResult {
  const remap = firstIdentityRemap(evidence)
  const ok = Boolean(
    remap?.previousKey &&
    remap.nextKey &&
    remap.from.stableId &&
    remap.to.stableId &&
    (remap.from.localId || remap.from.serverId) &&
    remap.to.serverId,
  )

  return {
    oracleId: 'identity-remap-modifier-contract',
    ok,
    message: remap
      ? `previousKey=${remap.previousKey ?? 'missing'} nextKey=${remap.nextKey}`
      : `modifier=${evidence.segment.modifier.type}`,
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

export function expectRemappedViewportAnchor(
  evidence: E2EEvidence,
): E2EOracleResult {
  const remap = firstIdentityRemap(evidence)
  const anchorEvent = [...evidence.events]
    .reverse()
    .find((event) => event.type === 'viewportAnchorChanged' && event.anchor)
  const anchor = anchorEvent?.anchor ?? null
  const matchesCommitted = Boolean(remap && anchor && matchesIdentity(anchor, remap.to))
  const localOnly = Boolean(
    remap &&
    anchor?.localId &&
    anchor.localId === remap.from.localId &&
    !anchor.serverId,
  )

  return {
    oracleId: 'identity-remap-viewport-anchor',
    ok: matchesCommitted && !localOnly,
    message: anchor
      ? `stableId=${anchor.stableId} serverId=${anchor.serverId ?? 'none'} localOnly=${localOnly}`
      : 'viewport anchor event missing',
  }
}

export function expectOverlayMirrorsNative(
  evidence: E2EEvidence,
  options: { tolerancePx: number },
): E2EOracleResult {
  const overlay = evidence.overlay

  if (!overlay) {
    return {
      oracleId: 'overlay-native-mirror',
      ok: false,
      message: 'overlay evidence missing',
    }
  }

  const topDelta = Math.abs(overlay.thumbTop - overlay.expectedThumbTop)
  const heightDelta = Math.abs(overlay.thumbHeight - overlay.expectedThumbHeight)

  return {
    oracleId: 'overlay-native-mirror',
    ok: overlay.visible &&
      topDelta <= options.tolerancePx &&
      heightDelta <= options.tolerancePx,
    message: `visible=${overlay.visible} topDelta=${topDelta} heightDelta=${heightDelta}`,
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

export function expectDetachAnchorCheckpoint(evidence: E2EEvidence): E2EOracleResult {
  const detach = evidence.events.find((event) =>
    event.type === 'viewportAnchorChanged' && event.reason === 'detach'
  )

  return {
    oracleId: 'detach-anchor-checkpoint',
    ok: Boolean(detach?.anchor),
    message: detach?.anchor ? 'detach anchor captured' : 'detach anchor missing',
  }
}

export function expectRestoreAroundAfterDetach(evidence: E2EEvidence): E2EOracleResult {
  return {
    oracleId: 'restore-around-after-detach',
    ok: evidence.segment.modifier.type === 'reset-around',
    message: `modifier=${evidence.segment.modifier.type}`,
  }
}

export function expectSegmentItemCountAtMost(
  evidence: E2EEvidence,
  maxItems: number,
): E2EOracleResult {
  return {
    oracleId: 'segment-item-budget',
    ok: evidence.segment.itemCount <= maxItems,
    message: `items=${evidence.segment.itemCount} max=${maxItems}`,
  }
}

export function expectDiagnosticsBounded(evidence: E2EEvidence): E2EOracleResult {
  return {
    oracleId: 'diagnostics-bounded',
    ok: evidence.diagnostics.length <= 120,
    message: `diagnostics=${evidence.diagnostics.length}`,
  }
}

type IdentityRemap = Extract<
  E2EEvidence['segment']['modifier'],
  { type: 'identity-remap' }
>['remaps'][number]

type VisibleRow = E2EEvidence['visibleRows'][number]

function firstIdentityRemap(evidence: E2EEvidence): IdentityRemap | null {
  const modifier = evidence.segment.modifier

  if (modifier.type !== 'identity-remap') {
    return null
  }

  return modifier.remaps[0] ?? null
}

function findRemapRow(
  evidence: E2EEvidence,
  key: string | undefined,
  identity: IdentityRemap['from'] | IdentityRemap['to'],
): VisibleRow | null {
  return evidence.visibleRows.find((row) =>
    (Boolean(key) && row.key === key) ||
    matchesIdentity(row, identity)
  ) ?? null
}

function matchesIdentity(
  candidate: {
    stableId?: string
    serverId?: string
    localId?: string
  },
  identity: {
    stableId?: string
    serverId?: string
    localId?: string
  },
): boolean {
  return Boolean(
    (identity.serverId && candidate.serverId === identity.serverId) ||
    (identity.stableId && candidate.stableId === identity.stableId) ||
    (identity.localId && candidate.localId === identity.localId),
  )
}

function findFirstCommonVisibleRow(
  before: E2EEvidence,
  after: E2EEvidence,
): {
  key: string
  before: E2EEvidence['visibleRows'][number]
  after: E2EEvidence['visibleRows'][number]
} | null {
  for (const beforeRow of before.visibleRows) {
    const afterRow = after.visibleRows.find((candidate) =>
      candidate.key === beforeRow.key ||
      (
        Boolean(candidate.stableId) &&
        candidate.stableId === beforeRow.stableId
      ) ||
      (
        Boolean(candidate.serverId) &&
        candidate.serverId === beforeRow.serverId
      )
    )

    if (afterRow) {
      return {
        key: beforeRow.key,
        before: beforeRow,
        after: afterRow,
      }
    }
  }

  return null
}
