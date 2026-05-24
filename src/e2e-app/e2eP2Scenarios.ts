import type { E2EActionStep } from './e2eP0Scenarios'

export type E2EP2ScenarioId =
  | 'edge.custom-scrollbar-drag-top'
  | 'edge.custom-scrollbar-drag-bottom'
  | 'lifecycle.strictmode-attach-detach-attach'
  | 'recovery.bootstrap-commit-timeout'

export type E2EP2ScenarioDefinition = {
  id: E2EP2ScenarioId
  priority: 'P2'
  title: string
  actionSteps: E2EActionStep[]
  oracleIds: string[]
}

export const E2E_P2_SCENARIO_DEFINITIONS: E2EP2ScenarioDefinition[] = [
  {
    id: 'edge.custom-scrollbar-drag-top',
    priority: 'P2',
    title: 'Custom scrollbar drag top edge',
    actionSteps: [
      { kind: 'reset', scenarioId: 'edge.custom-scrollbar-drag-top' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'drag_scrollbar_to_top' },
      { kind: 'action', actionId: 'wait_for_idle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'after' },
        checkpointAlias: 'after',
      },
    ],
    oracleIds: [
      'expectRuntimeIdle',
      'expectNeedMoreBeforeWithin:1',
    ],
  },
  {
    id: 'edge.custom-scrollbar-drag-bottom',
    priority: 'P2',
    title: 'Custom scrollbar drag bottom edge',
    actionSteps: [
      { kind: 'reset', scenarioId: 'edge.custom-scrollbar-drag-bottom' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'drag_scrollbar_to_bottom' },
      { kind: 'action', actionId: 'wait_for_idle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'after' },
        checkpointAlias: 'after',
      },
    ],
    oracleIds: [
      'expectRuntimeIdle',
      'expectNeedMoreAfterWithin:1',
    ],
  },
  {
    id: 'lifecycle.strictmode-attach-detach-attach',
    priority: 'P2',
    title: 'StrictMode attach detach attach',
    actionSteps: [
      { kind: 'reset', scenarioId: 'lifecycle.strictmode-attach-detach-attach' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'reattach_runtime' },
      { kind: 'action', actionId: 'wait_for_idle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'after' },
        checkpointAlias: 'after',
      },
    ],
    oracleIds: [
      'expectRuntimeIdle',
      'expectRuntimeAttachedOnce',
    ],
  },
  {
    id: 'recovery.bootstrap-commit-timeout',
    priority: 'P2',
    title: 'Bootstrap commit timeout recovery',
    actionSteps: [
      { kind: 'reset', scenarioId: 'recovery.bootstrap-commit-timeout' },
      { kind: 'action', actionId: 'wait_for_ready' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'after' },
        checkpointAlias: 'after',
      },
    ],
    oracleIds: [
      'expectRuntimeIdle',
      'expectViewportErrorObserved:commit-timeout-bootstrap',
    ],
  },
]

export function getE2EP2ScenarioDefinition(
  scenarioId: string,
): E2EP2ScenarioDefinition | null {
  return E2E_P2_SCENARIO_DEFINITIONS.find(
    (scenario) => scenario.id === scenarioId,
  ) ?? null
}
