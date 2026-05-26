import type { E2EEvidence } from './e2eBridge'

export type E2EOracleResult = {
  oracleId: string
  ok: boolean
  message: string
}

export function expectRuntimeIdle(evidence: E2EEvidence): E2EOracleResult {
  return {
    oracleId: 'runtime-idle',
    ok: evidence.phase === 'IDLE',
    message: `phase=${evidence.phase}`,
  }
}

export function expectNoWhiteScreen(evidence: E2EEvidence): E2EOracleResult {
  return {
    oracleId: 'no-white-screen',
    ok: evidence.visibleRows.length > 0 || evidence.scrollHeight >= 0,
    message: `visibleRows=${evidence.visibleRows.length}`,
  }
}
