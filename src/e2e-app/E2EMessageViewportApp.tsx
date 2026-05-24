import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DemoMessageViewportContent } from '../demo/DemoMessageViewport'
import { useDemoFeedRuntimeCache } from '../demo/useDemoFeedRuntimeCache'
import {
  type DemoMessageScenario,
  useDemoMessageScenario,
} from '../demo/useDemoMessageScenario'
import {
  clearE2EConsoleBuffer,
  collectE2EEvidence,
  collectE2EState,
  createBootingE2EState,
  createE2EConsoleBuffer,
  createE2EEventBuffer,
  type E2EActionResult,
  type E2EConsoleBuffer,
  type E2EEvidence,
  type E2EEventBuffer,
  type E2EState,
  installE2EConsoleCapture,
  listE2EActions,
  recordE2ERuntimeEvent,
  runE2EAction,
  type XMessageListE2EBridge,
} from './e2eBridge'
import { createE2EDemoStore, type E2EDemoStore } from './e2eDemoStore'
import {
  getDefaultE2EScenarioDefinition,
  getE2EScenarioDefinition,
  resolveInitialE2EScenarioId,
  type E2EScenarioDefinition,
} from './e2eScenarioRegistry'

type BridgeRuntime = Pick<
  XMessageListE2EBridge,
  'getState' | 'listActions' | 'runAction' | 'getEvidence'
>

export function E2EMessageViewportApp() {
  const initialScenario = useMemo(() => {
    const scenarioId = resolveInitialE2EScenarioId(window.location.search)
    return getE2EScenarioDefinition(scenarioId) ?? getDefaultE2EScenarioDefinition()
  }, [])
  const store = useMemo(() => createE2EDemoStore(initialScenario), [
    initialScenario,
  ])
  const consoleBuffer = useMemo(() => createE2EConsoleBuffer(), [])
  const bridgeRuntimeRef = useRef<BridgeRuntime>(
    createBootingBridgeRuntime(initialScenario.id),
  )
  const [scenario, setScenario] = useState(initialScenario)
  const [resetToken, setResetToken] = useState(0)

  const resetScenario = useCallback(async (
    scenarioId: string,
  ): Promise<E2EActionResult> => {
    const nextScenario = getE2EScenarioDefinition(scenarioId)

    if (!nextScenario) {
      return {
        ok: false,
        actionId: 'resetScenario',
        message: `unknown e2e scenario ${scenarioId}`,
        error: {
          code: 'unknown_scenario',
          details: { scenarioId },
        },
      }
    }

    store.resetScenario(nextScenario)
    clearE2EConsoleBuffer(consoleBuffer)
    bridgeRuntimeRef.current = createBootingBridgeRuntime(nextScenario.id)
    setScenario(nextScenario)
    setResetToken((token) => token + 1)
    window.history.replaceState(null, '', `/e2e?scenario=${nextScenario.id}`)
    await waitForNextPaint()

    return {
      ok: true,
      actionId: 'resetScenario',
      message: `reset ${nextScenario.id}`,
    }
  }, [consoleBuffer, store])

  const registerBridgeRuntime = useCallback((runtime: BridgeRuntime) => {
    bridgeRuntimeRef.current = runtime

    return () => {
      if (bridgeRuntimeRef.current === runtime) {
        bridgeRuntimeRef.current = createBootingBridgeRuntime(scenario.id)
      }
    }
  }, [scenario.id])

  useEffect(() => installE2EConsoleCapture(consoleBuffer), [consoleBuffer])

  useEffect(() => {
    const bridge: XMessageListE2EBridge = {
      version: 1,
      getState: () => bridgeRuntimeRef.current.getState(),
      listActions: () => bridgeRuntimeRef.current.listActions(),
      runAction: (actionId, payload) =>
        bridgeRuntimeRef.current.runAction(actionId, payload),
      getEvidence: () => bridgeRuntimeRef.current.getEvidence(),
      resetScenario,
    }

    window.__X_MESSAGE_LIST_E2E__ = bridge

    return () => {
      if (window.__X_MESSAGE_LIST_E2E__ === bridge) {
        delete window.__X_MESSAGE_LIST_E2E__
      }
    }
  }, [resetScenario])

  return (
    <E2EScenarioHost
      key={`${scenario.id}:${resetToken}`}
      scenarioDefinition={scenario}
      store={store}
      consoleBuffer={consoleBuffer}
      registerBridgeRuntime={registerBridgeRuntime}
      resetScenario={resetScenario}
    />
  )
}

function E2EScenarioHost({
  scenarioDefinition,
  store,
  consoleBuffer,
  registerBridgeRuntime,
  resetScenario,
}: {
  scenarioDefinition: E2EScenarioDefinition
  store: E2EDemoStore
  consoleBuffer: E2EConsoleBuffer
  registerBridgeRuntime: (runtime: BridgeRuntime) => () => void
  resetScenario: (scenarioId: string) => Promise<E2EActionResult>
}) {
  const runtimeCache = useDemoFeedRuntimeCache()
  const scenario = useDemoMessageScenario(runtimeCache, {
    api: store.api,
    storage: store.storage,
  })
  const rootRef = useRef<HTMLElement | null>(null)
  const scenarioRef = useRef<DemoMessageScenario>(scenario)
  const eventBuffer = useMemo<E2EEventBuffer>(() => createE2EEventBuffer(), [])
  const [state, setState] = useState<E2EState>(() =>
    createBootingE2EState(scenarioDefinition.id),
  )

  useEffect(() => {
    scenarioRef.current = scenario
  }, [scenario])

  const readState = useCallback(() => (
    collectE2EState({
      scenarioId: scenarioDefinition.id,
      scenario: scenarioRef.current,
      consoleBuffer,
      root: rootRef.current ?? document,
    })
  ), [consoleBuffer, scenarioDefinition.id])

  const readEvidence = useCallback((checkpointId = 'manual') => (
    collectE2EEvidence({
      scenarioId: scenarioDefinition.id,
      checkpointId,
      scenario: scenarioRef.current,
      consoleBuffer,
      eventBuffer,
      root: rootRef.current ?? document,
    })
  ), [consoleBuffer, eventBuffer, scenarioDefinition.id])

  useEffect(() => registerBridgeRuntime({
    getState: readState,
    listActions: () => listE2EActions(readState()),
    getEvidence: () => readEvidence('manual'),
    runAction: (actionId, payload) =>
      runE2EAction({
        actionId,
        payload,
        scenarioId: scenarioDefinition.id,
        scenario: scenarioRef.current,
        consoleBuffer,
        eventBuffer,
        root: rootRef.current ?? document,
        readState,
        readEvidence,
      }),
  }), [
    consoleBuffer,
    eventBuffer,
    readEvidence,
    readState,
    registerBridgeRuntime,
    scenarioDefinition.id,
  ])

  useEffect(() => {
    const refresh = () => {
      setState(readState())
    }

    refresh()
    const unsubscribe = scenario.activeRuntime.subscribe(refresh)
    const intervalId = window.setInterval(refresh, 250)

    return () => {
      unsubscribe()
      window.clearInterval(intervalId)
    }
  }, [readState, scenario.activeRuntime])

  useEffect(() => scenario.activeRuntime.subscribeEvent((event) => {
    recordE2ERuntimeEvent(eventBuffer, event)
  }), [eventBuffer, scenario.activeRuntime])

  const resetCurrentScenario = useCallback(() => {
    void resetScenario(scenarioDefinition.id)
  }, [resetScenario, scenarioDefinition.id])

  return (
    <DemoMessageViewportContent
      rootRef={rootRef}
      scenario={scenario}
      e2e={{
        statusRegion: (
          <E2EAIStatusRegion
            state={state}
            seedLabel={scenarioDefinition.seedLabel}
          />
        ),
        onResetScenario: resetCurrentScenario,
      }}
    />
  )
}

function E2EAIStatusRegion({
  state,
  seedLabel,
}: {
  state: E2EState
  seedLabel: string
}) {
  const visibleRange = state.viewport.firstVisibleMessageId &&
    state.viewport.lastVisibleMessageId
    ? `${state.viewport.firstVisibleMessageId}..${state.viewport.lastVisibleMessageId}`
    : 'none'

  return (
    <section
      className="e2e-ai-status"
      role="status"
      aria-live="polite"
      data-testid="e2e-ai-status"
    >
      <div>Scenario: {state.scenarioId}</div>
      <div>Status: {state.scenarioStatus}</div>
      <div>
        Runtime: {state.runtime.state} / {state.runtime.transactionState}
      </div>
      <div>
        Feed: {state.feed.activeFeedId} / generation {state.feed.generation} /
        revision {state.feed.revision}
      </div>
      <div>Visible: {visibleRange}</div>
      <div>Bottom lock: {state.runtime.bottomLockState}</div>
      <div>Seed: {seedLabel}</div>
    </section>
  )
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

function createBootingBridgeRuntime(scenarioId: string): BridgeRuntime {
  return {
    getState: () => createBootingE2EState(scenarioId),
    listActions: () => [],
    runAction: async (actionId) => ({
      ok: false,
      actionId,
      message: 'e2e scenario host is still booting',
      error: {
        code: 'scenario_host_booting',
      },
    }),
    getEvidence: (): E2EEvidence => {
      throw new Error('e2e scenario host is still booting')
    },
  }
}
