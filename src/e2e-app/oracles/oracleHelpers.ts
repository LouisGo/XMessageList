import type { E2EEvidence } from '../bridge/e2eBridge.ts'

export type IdentityRemap = Extract<
  E2EEvidence['segment']['modifier'],
  { type: 'identity-remap' }
>['remaps'][number]

export type VisibleRow = E2EEvidence['visibleRows'][number]

export function firstIdentityRemap(evidence: E2EEvidence): IdentityRemap | null {
  const modifier = evidence.segment.modifier

  if (modifier.type !== 'identity-remap') {
    return null
  }

  return modifier.remaps[0] ?? null
}

export function findRemapRow(
  evidence: E2EEvidence,
  key: string | undefined,
  identity: IdentityRemap['from'] | IdentityRemap['to'],
): VisibleRow | null {
  return evidence.visibleRows.find((row) =>
    (Boolean(key) && row.key === key) ||
    matchesIdentity(row, identity)
  ) ?? null
}

export function matchesIdentity(
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

export function findFirstCommonVisibleRow(
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
