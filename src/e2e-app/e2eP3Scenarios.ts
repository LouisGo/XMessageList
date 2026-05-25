import type { E2EActionStep } from './e2eP0Scenarios'

export type E2EP3ScenarioId =
  | 'storm.quote-jump-during-event-storm'
  | 'storm.follow-bottom-with-bot-push'
  | 'storm.dynamic-height-session-switch'

export type E2EP3ScenarioDefinition = {
  id: E2EP3ScenarioId
  priority: 'P3'
  title: string
  actionSteps: E2EActionStep[]
  oracleIds: string[]
  gate: 'exploratory'
}

export const E2E_P3_SCENARIO_DEFINITIONS: E2EP3ScenarioDefinition[] = [
  {
    id: 'storm.quote-jump-during-event-storm',
    priority: 'P3',
    title: 'Quote jump during event storm',
    gate: 'exploratory',
    actionSteps: [
      { kind: 'reset', scenarioId: 'storm.quote-jump-during-event-storm' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'toggle_event_storm' },
      { kind: 'action', actionId: 'scroll_to_middle' },
      { kind: 'action', actionId: 'jump_to_quoted_message' },
      { kind: 'action', actionId: 'toggle_event_storm' },
      { kind: 'action', actionId: 'wait_for_idle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'after' },
        checkpointAlias: 'after',
      },
    ],
    oracleIds: [
      'expectNoWhiteScreen',
      'expectRuntimeIdle',
      'expectDestinationOutcomeRecorded',
    ],
  },
  {
    id: 'storm.follow-bottom-with-bot-push',
    priority: 'P3',
    title: 'Follow bottom with bot push',
    gate: 'exploratory',
    actionSteps: [
      { kind: 'reset', scenarioId: 'storm.follow-bottom-with-bot-push' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'scroll_to_middle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'before' },
        checkpointAlias: 'before',
      },
      { kind: 'action', actionId: 'toggle_bot_push' },
      { kind: 'action', actionId: 'follow_bottom' },
      { kind: 'action', actionId: 'toggle_bot_push' },
      { kind: 'action', actionId: 'wait_for_idle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'after' },
        checkpointAlias: 'after',
      },
    ],
    oracleIds: [
      'expectNoWhiteScreen',
      'expectRuntimeIdle',
      'expectBottomLocked',
    ],
  },
  {
    id: 'storm.dynamic-height-session-switch',
    priority: 'P3',
    title: 'Dynamic height session switch storm',
    gate: 'exploratory',
    actionSteps: [
      { kind: 'reset', scenarioId: 'storm.dynamic-height-session-switch' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'scroll_to_middle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'before' },
        checkpointAlias: 'before',
      },
      { kind: 'action', actionId: 'toggle_dynamic_height' },
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
      'expectNoWhiteScreen',
      'expectRuntimeIdle',
      'expectNoFeedPollution',
    ],
  },
]

export function getE2EP3ScenarioDefinition(
  scenarioId: string,
): E2EP3ScenarioDefinition | null {
  return E2E_P3_SCENARIO_DEFINITIONS.find(
    (scenario) => scenario.id === scenarioId,
  ) ?? null
}
