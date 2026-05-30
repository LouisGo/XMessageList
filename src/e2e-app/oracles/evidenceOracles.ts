import type { E2EEvidence } from '../bridge/e2eBridge.ts'
import type { E2EOracleResult } from './oracleResult.ts'

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
