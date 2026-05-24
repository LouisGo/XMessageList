import type { E2EActionStep } from './e2eP0Scenarios'

export type E2EP1ScenarioId =
  | 'bottom.locked-append-follow'
  | 'destination.quote-jump-visible-target'
  | 'dynamic-height.anchor-above-growth'
  | 'session.switch-restore-runtime-cache'

export type E2EP1ScenarioDefinition = {
  id: E2EP1ScenarioId
  priority: 'P1'
  title: string
  actionSteps: E2EActionStep[]
  oracleIds: string[]
}

export const E2E_P1_SCENARIO_DEFINITIONS: E2EP1ScenarioDefinition[] = [
  {
    id: 'bottom.locked-append-follow',
    priority: 'P1',
    title: 'Locked bottom append follows latest',
    actionSteps: [
      { kind: 'reset', scenarioId: 'bottom.locked-append-follow' },
      { kind: 'action', actionId: 'wait_for_ready' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'before' },
        checkpointAlias: 'before',
      },
      { kind: 'action', actionId: 'append_message' },
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
      'expectBottomLocked',
      'expectLatestMessageVisible',
    ],
  },
  {
    id: 'destination.quote-jump-visible-target',
    priority: 'P1',
    title: 'Quote jump settles on visible target',
    actionSteps: [
      { kind: 'reset', scenarioId: 'destination.quote-jump-visible-target' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'scroll_to_middle' },
      { kind: 'action', actionId: 'jump_to_quoted_message' },
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
      'expectDestinationSettledOnTarget',
    ],
  },
  {
    id: 'dynamic-height.anchor-above-growth',
    priority: 'P1',
    title: 'Dynamic height preserves reading anchor',
    actionSteps: [
      { kind: 'reset', scenarioId: 'dynamic-height.anchor-above-growth' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'scroll_to_middle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'before' },
        checkpointAlias: 'before',
      },
      { kind: 'action', actionId: 'toggle_dynamic_height' },
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
      'expectAnchorPreserved',
      'expectDiagnosticObserved:correction.anchorPreserved',
    ],
  },
  {
    id: 'session.switch-restore-runtime-cache',
    priority: 'P1',
    title: 'Session switch restores runtime cache',
    actionSteps: [
      { kind: 'reset', scenarioId: 'session.switch-restore-runtime-cache' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'scroll_to_middle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'before' },
        checkpointAlias: 'before',
      },
      {
        kind: 'action',
        actionId: 'switch_feed',
        payload: { feedId: 'feed-release' },
      },
      { kind: 'action', actionId: 'wait_for_ready' },
      {
        kind: 'action',
        actionId: 'switch_feed',
        payload: { feedId: 'feed-runtime' },
      },
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
      'expectNoFeedPollution',
      'expectAnchorPreserved',
    ],
  },
]

export function getE2EP1ScenarioDefinition(
  scenarioId: string,
): E2EP1ScenarioDefinition | null {
  return E2E_P1_SCENARIO_DEFINITIONS.find(
    (scenario) => scenario.id === scenarioId,
  ) ?? null
}
