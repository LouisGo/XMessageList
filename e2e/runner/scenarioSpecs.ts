import type { E2EActionResult, E2EEvidence } from '../../src/e2e-app/e2eBridge.ts'
import {
  expectAnchorPreserved,
  expectBottomLocked,
  expectDetachAnchorCheckpoint,
  expectDiagnosticsBounded,
  expectEvidenceContract,
  expectIdentityRemapModifierContract,
  expectLocalAlignWithoutAround,
  expectModifier,
  expectNeedEventCount,
  expectNoSpacerEvidence,
  expectNoViewportErrors,
  expectNoWhiteScreen,
  expectOverlayMirrorsNative,
  expectRuntimeIdle,
  expectRemappedAnchorPreserved,
  expectRemappedViewportAnchor,
  expectRestoreAroundAfterDetach,
  expectScrollHeightIncreased,
  expectScrollTopIncreased,
  expectSegmentItemCountAtMost,
  expectUnderflowSingleFlight,
  expectVisibleIdentity,
  type E2EOracleResult,
} from '../../src/e2e-app/e2eOracles.ts'

export type { E2EOracleResult }

export type Lane = 'correctness' | 'perf'
export type ScenarioPriority = 'p0' | 'all'
export type ScenarioContext = {
  results: E2EActionResult[]
  evidence: Map<string, E2EEvidence>
  finalEvidence: E2EEvidence
}
export type ScenarioSpec = {
  id: string
  priority: 'p0' | 'p1' | 'p2' | 'p3' | 'p4' | 'perf'
  actions: Array<{
    id: string
    payload?: Record<string, unknown>
    saveAs?: string
  }>
  oracles: (context: ScenarioContext) => E2EOracleResult[]
}

const BASE_ORACLES = (evidence: E2EEvidence): E2EOracleResult[] => [
  expectRuntimeIdle(evidence),
  expectNoWhiteScreen(evidence),
  expectEvidenceContract(evidence),
  expectNoSpacerEvidence(evidence),
  expectNoViewportErrors(evidence),
]

export const CORRECTNESS_SCENARIOS: ScenarioSpec[] = [
  {
    id: 'bootstrap.latest-native-bottom',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'final' }, saveAs: 'final' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectBottomLocked(finalEvidence, { thresholdPx: 2 }),
    ],
  },
  {
    id: 'paging.before-native-thumb-rebound',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      {
        id: 'trigger_before_edge',
        payload: { beforeCheckpointId: 'before', responseDelayMs: 160 },
        saveAs: 'after',
      },
    ],
    oracles: (context) => {
      const before = mustEvidence(context, 'before')
      const after = mustEvidence(context, 'after')
      return [
        ...BASE_ORACLES(after),
        expectNeedEventCount(after, 'needMoreBefore', 1),
        expectAnchorPreserved(before, after, { tolerancePx: 1 }),
        expectScrollHeightIncreased(before, after),
        expectScrollTopIncreased(before, after),
      ]
    },
  },
  {
    id: 'paging.after-native-thumb-rebound',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'trigger_after_edge' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => {
      const before = mustEvidence(context, 'before')
      const after = mustEvidence(context, 'after')
      return [
        ...BASE_ORACLES(after),
        expectNeedEventCount(after, 'needMoreAfter', 1),
        expectScrollHeightIncreased(before, after),
      ]
    },
  },
  {
    id: 'underflow.dual-edge-arbitration',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'final' }, saveAs: 'final' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectUnderflowSingleFlight(finalEvidence),
    ],
  },
  {
    id: 'identity.optimistic-server-remap',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_bottom' },
      { id: 'send_optimistic_message' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'resolve_optimistic_remap' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => {
      const before = mustEvidence(context, 'before')
      const after = mustEvidence(context, 'after')
      return [
        ...BASE_ORACLES(after),
        expectModifier(after, 'identity-remap'),
        expectIdentityRemapModifierContract(after),
        expectRemappedAnchorPreserved(before, after, { tolerancePx: 1 }),
        expectRemappedViewportAnchor(after),
      ]
    },
  },
  {
    id: 'dynamic-height.above-anchor-growth',
    priority: 'p1',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_middle' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'toggle_dynamic_height' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => [
      ...BASE_ORACLES(context.finalEvidence),
      expectAnchorPreserved(
        mustEvidence(context, 'before'),
        mustEvidence(context, 'after'),
        { tolerancePx: 1 },
      ),
    ],
  },
  {
    id: 'dynamic-height.streaming-current-row',
    priority: 'p1',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_middle' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'stream_current_row' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => [
      ...BASE_ORACLES(context.finalEvidence),
      expectAnchorPreserved(
        mustEvidence(context, 'before'),
        mustEvidence(context, 'after'),
        { tolerancePx: 1 },
      ),
    ],
  },
  {
    id: 'destination.jump-in-segment',
    priority: 'p2',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'jump_to_first_loaded' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => [
      ...BASE_ORACLES(context.finalEvidence),
      expectLocalAlignWithoutAround(
        mustEvidence(context, 'before'),
        mustEvidence(context, 'after'),
      ),
      expectVisibleIdentity(context.finalEvidence, context.finalEvidence.segment.firstKey ?? ''),
    ],
  },
  {
    id: 'destination.jump-outside-segment',
    priority: 'p2',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'jump_to_oldest' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectNeedEventCount(finalEvidence, 'needMessagesAround', 1),
      expectVisibleIdentity(finalEvidence, 'feed-runtime-0001'),
    ],
  },
  {
    id: 'follow-bottom.partial-segment',
    priority: 'p2',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'follow_bottom' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectNeedEventCount(finalEvidence, 'needLatestMessages', 1),
      expectBottomLocked(finalEvidence, { thresholdPx: 2 }),
    ],
  },
  {
    id: 'feed-switch.detach-anchor-checkpoint',
    priority: 'p3',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_middle' },
      { id: 'switch_feed_roundtrip' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectDetachAnchorCheckpoint(finalEvidence),
      expectRestoreAroundAfterDetach(finalEvidence),
    ],
  },
  {
    id: 'strictmode.attach-detach-attach',
    priority: 'p3',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'remount_viewport' },
      { id: 'remount_viewport' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectDiagnosticsBounded(finalEvidence),
    ],
  },
  {
    id: 'segment-budget.trim-after-appends',
    priority: 'p2',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'append_many', payload: { count: 105 } },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectSegmentItemCountAtMost(finalEvidence, 120),
      expectModifier(finalEvidence, 'trim-before'),
      expectBottomLocked(finalEvidence, { thresholdPx: 2 }),
    ],
  },
  {
    id: 'scrollbar.overlay-native-mirror',
    priority: 'p4',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'final' }, saveAs: 'final' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectOverlayMirrorsNative(finalEvidence, { tolerancePx: 2 }),
    ],
  },
  {
    id: 'scrollbar.drag-edge-before',
    priority: 'p4',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'drag_scrollbar_to_top' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectNeedEventCount(finalEvidence, 'needMoreBefore', 1),
      expectOverlayMirrorsNative(finalEvidence, { tolerancePx: 2 }),
    ],
  },
  {
    id: 'scrollbar.drag-edge-after',
    priority: 'p4',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'drag_scrollbar_to_bottom' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectNeedEventCount(finalEvidence, 'needMoreAfter', 1),
      expectOverlayMirrorsNative(finalEvidence, { tolerancePx: 2 }),
    ],
  },
  {
    id: 'scrollbar.track-click-no-global-jump',
    priority: 'p4',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'track_click_scrollbar', payload: { ratio: 0.35 } },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => [
      ...BASE_ORACLES(context.finalEvidence),
      expectNoViewportErrors(context.finalEvidence),
      expectOverlayMirrorsNative(context.finalEvidence, { tolerancePx: 2 }),
    ],
  },
]

export const PERF_SCENARIOS: ScenarioSpec[] = [
  {
    id: 'perf.scroll-observation-budget',
    priority: 'perf',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'start_event_storm' },
      { id: 'wait_for_idle' },
      { id: 'stop_event_storm' },
      { id: 'start_bot_push' },
      { id: 'wait_for_idle' },
      { id: 'stop_bot_push' },
      { id: 'scroll_to_middle' },
      { id: 'scroll_to_bottom' },
      { id: 'scroll_to_middle' },
      { id: 'collect_evidence', payload: { checkpointId: 'final' }, saveAs: 'final' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectDiagnosticsBounded(finalEvidence),
    ],
  },
]

function mustEvidence(
  context: ScenarioContext,
  key: string,
): E2EEvidence {
  const evidence = context.evidence.get(key)

  if (!evidence) {
    throw new Error(`missing evidence ${key}`)
  }

  return evidence
}
