import { useCallback, useEffect, useMemo, useRef } from 'react'
import { DemoMessageListContent } from '../demo/DemoMessageList'
import { useDemoFeedRuntimeCache } from '../demo/useDemoFeedRuntimeCache'
import { useDemoMessageScenario } from '../demo/useDemoMessageScenario'
import {
  createE2EState,
  type E2EActionResult,
  type E2EEvidence,
  type XMessageListE2EBridge,
} from './e2eBridge'

export function E2EMessageListApp() {
  const runtimeCache = useDemoFeedRuntimeCache()
  const scenario = useDemoMessageScenario(runtimeCache)
  const rootRef = useRef<HTMLElement | null>(null)
  const scenarioId = 'phase1-contract-shell'
  const readEvidence = useCallback((checkpointId: string): E2EEvidence => ({
    ...scenario.activeRuntime.getEvidence(),
    schemaVersion: 2,
    scenarioId,
    checkpointId,
    timestamp: Date.now(),
  }), [scenario.activeRuntime])
  const bridge = useMemo<XMessageListE2EBridge>(() => ({
    version: 1,
    getState: () => createE2EState(scenarioId, readEvidence('state')),
    listActions: () => [
      { id: 'noop', label: 'No-op', enabled: true },
    ],
    runAction: async (actionId): Promise<E2EActionResult> => ({
      ok: actionId === 'noop',
      actionId,
      message: actionId === 'noop' ? 'ok' : 'unknown action',
      before: readEvidence('before'),
      after: readEvidence('after'),
      error: actionId === 'noop' ? undefined : { code: 'unknown_action' },
    }),
    getEvidence: () => readEvidence('manual'),
    resetScenario: async (actionScenarioId): Promise<E2EActionResult> => ({
      ok: actionScenarioId === scenarioId,
      actionId: 'resetScenario',
      message: `reset ${actionScenarioId}`,
      after: readEvidence('reset'),
    }),
  }), [readEvidence])

  useEffect(() => {
    window.__X_MESSAGE_LIST_E2E__ = bridge
    return () => {
      if (window.__X_MESSAGE_LIST_E2E__ === bridge) {
        delete window.__X_MESSAGE_LIST_E2E__
      }
    }
  }, [bridge])

  return (
    <DemoMessageListContent
      rootRef={rootRef}
      scenario={scenario}
      e2e={{
        statusRegion: <section className="e2e-ai-status">Phase 1 shell</section>,
        onResetScenario: () => undefined,
      }}
    />
  )
}
