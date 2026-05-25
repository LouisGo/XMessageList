import type { E2EActionStep } from './e2eP0Scenarios'

export type E2EPerformanceScenarioId =
  | 'perf.bootstrap-latest-budget'
  | 'perf.send-ack-latency-budget'
  | 'perf.prepend-latency-budget'

export type E2EPerformanceScenarioDefinition = {
  id: E2EPerformanceScenarioId
  priority: 'PERF'
  title: string
  actionSteps: E2EActionStep[]
  oracleIds: string[]
  gate: 'performance'
}

export const E2E_PERFORMANCE_SCENARIO_DEFINITIONS: E2EPerformanceScenarioDefinition[] = [
  {
    id: 'perf.bootstrap-latest-budget',
    priority: 'PERF',
    title: 'Bootstrap latest performance budget',
    gate: 'performance',
    actionSteps: [
      { kind: 'reset', scenarioId: 'perf.bootstrap-latest-budget' },
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
      'expectLatestMessageVisible',
      'expectNoLongTasks:100:0',
      'expectActionDurationWithin:wait_for_ready:2500',
      'expectFrameGapWithin:250',
    ],
  },
  {
    id: 'perf.send-ack-latency-budget',
    priority: 'PERF',
    title: 'Send optimistic ack performance budget',
    gate: 'performance',
    actionSteps: [
      { kind: 'reset', scenarioId: 'perf.send-ack-latency-budget' },
      { kind: 'action', actionId: 'wait_for_ready' },
      {
        kind: 'action',
        actionId: 'send_message',
        payload: {
          body: 'E2E performance send should stay responsive.',
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
      'expectVisibleOptimisticRow:sending',
      'expectRuntimeIdle',
      'expectNoOptimisticRows',
      'expectBottomLocked',
      'expectLatestMessageVisible',
      'expectNoLongTasks:100:0',
      'expectActionDurationWithin:send_message:500',
      'expectActionDurationWithin:wait_for_idle:1500',
      'expectFrameGapWithin:250',
    ],
  },
  {
    id: 'perf.prepend-latency-budget',
    priority: 'PERF',
    title: 'Prepend history performance budget',
    gate: 'performance',
    actionSteps: [
      { kind: 'reset', scenarioId: 'perf.prepend-latency-budget' },
      { kind: 'action', actionId: 'wait_for_ready' },
      { kind: 'action', actionId: 'scroll_to_middle' },
      {
        kind: 'action',
        actionId: 'collect_evidence',
        payload: { checkpointId: 'before' },
        checkpointAlias: 'before',
      },
      { kind: 'action', actionId: 'prepend_history' },
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
      'expectLoadedMessageCountDelta:20',
      'expectNoLongTasks:100:0',
      'expectActionDurationWithin:prepend_history:1500',
      'expectFrameGapWithin:250',
    ],
  },
]

export function getE2EPerformanceScenarioDefinition(
  scenarioId: string,
): E2EPerformanceScenarioDefinition | null {
  return E2E_PERFORMANCE_SCENARIO_DEFINITIONS.find(
    (scenario) => scenario.id === scenarioId,
  ) ?? null
}
