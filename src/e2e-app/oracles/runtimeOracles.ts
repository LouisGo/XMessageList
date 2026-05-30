import type { E2EEvidence } from '../bridge/e2eBridge.ts'
import {
  firstIdentityRemap,
  matchesIdentity,
} from './oracleHelpers.ts'
import type { E2EOracleResult } from './oracleResult.ts'

export function expectRuntimeIdle(evidence: E2EEvidence): E2EOracleResult {
  return {
    oracleId: 'runtime-idle',
    ok: evidence.phase === 'IDLE' && evidence.pendingIntent === null,
    message: `phase=${evidence.phase} pending=${evidence.pendingIntent}`,
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
  const settled = evidence.events.some((event) => event.type === 'destinationSettled')

  return {
    oracleId: 'restore-around-after-detach',
    ok: evidence.segment.modifier.type === 'reset-around' || settled,
    message: `modifier=${evidence.segment.modifier.type} settled=${settled}`,
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
