import type { E2EActionStep } from './e2eP0Scenarios'

export type E2EP1ScenarioId =
  | 'bottom.locked-append-follow'
  | 'destination.quote-jump-visible-target'
  | 'destination.quote-jump-unloaded-target'
  | 'send.optimistic-ack-follow-bottom'
  | 'send.optimistic-fail-retry'
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
    id: 'destination.quote-jump-unloaded-target',
    priority: 'P1',
    title: 'Quote jump requests unloaded target',
    actionSteps: [
      { kind: 'reset', scenarioId: 'destination.quote-jump-unloaded-target' },
      { kind: 'action', actionId: 'wait_for_ready' },
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
      'expectNeedMessagesAroundObserved:jump',
      'expectDestinationSettledOnTarget',
    ],
  },
  {
    id: 'send.optimistic-ack-follow-bottom',
    priority: 'P1',
    title: 'Optimistic send ack keeps bottom lock',
    actionSteps: [
      { kind: 'reset', scenarioId: 'send.optimistic-ack-follow-bottom' },
      { kind: 'action', actionId: 'wait_for_ready' },
      {
        kind: 'action',
        actionId: 'send_message',
        payload: {
          body: 'E2E optimistic send should rebind to a committed row.',
          waitFor: 'optimistic',
          checkpointId: 'during',
        },
        checkpointAlias: 'during',
      },
      { kind: 'action', actionId: 'wait_for_idle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'after' },
        checkpointAlias: 'after',
      },
    ],
    oracleIds: [
      'expectVisibleOptimisticRow',
      'expectRuntimeIdle',
      'expectNoOptimisticRows',
      'expectBottomLocked',
      'expectLatestMessageVisible',
    ],
  },
  {
    id: 'send.optimistic-fail-retry',
    priority: 'P1',
    title: 'Optimistic send failure retries with same identity',
    actionSteps: [
      { kind: 'reset', scenarioId: 'send.optimistic-fail-retry' },
      { kind: 'action', actionId: 'wait_for_ready' },
      {
        kind: 'action',
        actionId: 'send_message',
        payload: {
          body: 'E2E failed optimistic send should retry with the same key.',
          waitFor: 'failed',
        },
      },
      { kind: 'action', actionId: 'wait_for_idle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'failed' },
        checkpointAlias: 'failed',
      },
      {
        kind: 'action',
        actionId: 'retry_failed_send',
        payload: {
          waitFor: 'optimistic',
          checkpointId: 'retrying',
        },
        checkpointAlias: 'retrying',
      },
      { kind: 'action', actionId: 'wait_for_idle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'after' },
        checkpointAlias: 'after',
      },
    ],
    oracleIds: [
      'expectVisibleOptimisticRow:failed',
      'expectVisibleOptimisticRow:sending',
      'expectSameVisibleOptimisticKey',
      'expectNoCommittedRowsBeyondFeedMessageCount',
      'expectRuntimeIdle',
      'expectNoOptimisticRows',
      'expectBottomLocked',
      'expectLatestMessageVisible',
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
