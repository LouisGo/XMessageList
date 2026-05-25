export type E2EP0ScenarioId =
  | 'bootstrap.latest-bottom-lock'
  | 'paging.prepend-anchor-preservation'
  | 'bottom.user-scroll-up-append-no-follow'

export type E2EScenarioActionId =
  | 'wait_for_ready'
  | 'wait_for_idle'
  | 'collect_evidence'
  | 'scroll_to_middle'
  | 'scroll_to_history_top'
  | 'scroll_to_bottom'
  | 'append_message'
  | 'prepend_history'
  | 'start_prepend_history'
  | 'send_message'
  | 'follow_bottom'
  | 'jump_to_quoted_message'
  | 'switch_feed'
  | 'toggle_dynamic_height'
  | 'drag_scrollbar_to_top'
  | 'drag_scrollbar_to_bottom'
  | 'reattach_runtime'
  | 'toggle_event_storm'
  | 'toggle_bot_push'

export type E2EActionStep =
  | {
      kind: 'reset'
      scenarioId: string
    }
  | {
      kind: 'action'
      actionId: E2EScenarioActionId
      payload?: Record<string, unknown>
      checkpointAlias?: 'before' | 'during' | 'after' | 'final'
    }

export type E2EP0ActionStep = E2EActionStep

export type E2EP0ScenarioDefinition = {
  id: E2EP0ScenarioId
  priority: 'P0'
  title: string
  actionSteps: E2EP0ActionStep[]
  oracleIds: string[]
}

export const E2E_P0_SCENARIO_DEFINITIONS: E2EP0ScenarioDefinition[] = [
  {
    id: 'bootstrap.latest-bottom-lock',
    priority: 'P0',
    title: 'Bootstrap latest bottom lock',
    actionSteps: [
      { kind: 'reset', scenarioId: 'bootstrap.latest-bottom-lock' },
      { kind: 'action', actionId: 'wait_for_ready' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'final' },
        checkpointAlias: 'final',
      },
    ],
    oracleIds: [
      'expectRuntimeIdle',
      'expectBottomLocked',
    ],
  },
  {
    id: 'paging.prepend-anchor-preservation',
    priority: 'P0',
    title: 'Prepend anchor preservation',
    actionSteps: [
      { kind: 'reset', scenarioId: 'paging.prepend-anchor-preservation' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'scroll_to_middle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'before' },
        checkpointAlias: 'before',
      },
      { kind: 'action', actionId: 'prepend_history' },
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
    ],
  },
  {
    id: 'bottom.user-scroll-up-append-no-follow',
    priority: 'P0',
    title: 'User scroll up append no follow',
    actionSteps: [
      { kind: 'reset', scenarioId: 'bottom.user-scroll-up-append-no-follow' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'scroll_to_middle' },
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
      'expectNoFollowWhenUserReading',
    ],
  },
]

export function getE2EP0ScenarioDefinition(
  scenarioId: string,
): E2EP0ScenarioDefinition | null {
  return E2E_P0_SCENARIO_DEFINITIONS.find(
    (scenario) => scenario.id === scenarioId,
  ) ?? null
}
