import type { ViewportEvidence } from '../runtime'

export type E2EScenarioStatus = 'booting' | 'ready' | 'running' | 'failed'

export type E2EState = {
  scenarioId: string
  scenarioStatus: E2EScenarioStatus
  runtime: {
    phase: string
    bottomLockState: string
  }
  viewport: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    visibleRows: number
  }
}

export type E2EActionDescriptor = {
  id: string
  label: string
  enabled: boolean
}

export type E2EActionResult = {
  ok: boolean
  actionId: string
  message: string
  before?: E2EEvidence
  after?: E2EEvidence
  error?: {
    code: string
    details?: Record<string, unknown>
  }
}

export type E2EEvidence = ViewportEvidence & {
  schemaVersion: 2
  scenarioId: string
  checkpointId: string
  timestamp: number
}

export type XMessageListE2EBridge = {
  version: 1
  getState: () => E2EState
  listActions: () => E2EActionDescriptor[]
  runAction: (
    actionId: string,
    payload?: Record<string, unknown>,
  ) => Promise<E2EActionResult>
  getEvidence: () => E2EEvidence
  resetScenario: (scenarioId: string) => Promise<E2EActionResult>
}

declare global {
  interface Window {
    __X_MESSAGE_LIST_E2E__?: XMessageListE2EBridge
  }
}

export function createE2EState(
  scenarioId: string,
  evidence: E2EEvidence,
): E2EState {
  return {
    scenarioId,
    scenarioStatus: 'ready',
    runtime: {
      phase: evidence.phase,
      bottomLockState: evidence.bottomLockState,
    },
    viewport: {
      scrollTop: evidence.scrollTop,
      scrollHeight: evidence.scrollHeight,
      clientHeight: evidence.clientHeight,
      visibleRows: evidence.visibleRows.length,
    },
  }
}
