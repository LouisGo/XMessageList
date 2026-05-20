import { computePhysicalHeightBudget } from '../geometry/budget/heightBudget'
import { computeRealRowCoverage } from '../geometry/measurement/coverage'
import { selectPhysicalRows } from '../geometry/window/rowSelection'
import { solveLocalSpacers } from '../geometry/window/spacerSolver'
import type {
  AnchorState,
  MessageRuntimeItemKey,
} from '../identity/types'
import { anchorToCommittedItemKey, stringifyMessageRuntimeItemKey } from '../identity/itemKey'
import type {
  PhysicalRowSelectionDirectionHint,
} from '../geometry/window/rowSelection.types'
import type {
  LocalSpacerPlacement,
} from '../geometry/window/spacerSolver.types'
import type {
  GeometryBuildInput,
  GeometryBuildKind,
  GeometryBuildPlan,
  MetricsDerivationInput,
} from './geometryBuilder.types'
import {
  resolveGeometryCandidateItems,
  resolveRelayoutAnchor,
} from './geometryBuilderRelayout'
import type { PhysicalSegmentDraft, PhysicalSegmentRole } from '../geometry/segment/physicalSegment.types'
import type { PhysicalScrollMetrics } from '../geometry/types'

const EMPTY_SEGMENT_KEY: MessageRuntimeItemKey = {
  kind: 'committed',
  messageId: '__runtime_next_empty_segment__',
}

export function buildGeometryPlan<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  input: GeometryBuildInput<TMessage, TOptimistic>,
): GeometryBuildPlan<TMessage, TOptimistic> {
  const clientHeight = input.viewportSize.clientHeight
  const normalBudget = computePhysicalHeightBudget({
    clientHeight,
    mountedRowsHeight: 0,
  })
  const candidateItems = resolveGeometryCandidateItems(input)
  const anchor = resolveAnchor(input)
  const directionHint = resolveDirectionHint(input.kind, input.direction)
  const selection = selectPhysicalRows({
    items: candidateItems,
    anchor,
    directionHint,
    physicalWindowHeight: normalBudget.physicalWindowHeight,
  })
  const allItemsMounted =
    selection.itemKeys.length === candidateItems.length &&
    !input.data.hasMoreBefore &&
    !input.data.hasMoreAfter
  const isShortFeed =
    allItemsMounted &&
    selection.mountedRowsHeightEstimate < clientHeight
  const budget = isShortFeed
    ? computePhysicalHeightBudget({
        clientHeight,
        mountedRowsHeight: selection.mountedRowsHeightEstimate,
        isShortFeed: true,
        shortFeedContentHeight: selection.mountedRowsHeightEstimate,
      })
    : computePhysicalHeightBudget({
        clientHeight,
        mountedRowsHeight: selection.mountedRowsHeightEstimate,
      })
  const spacers = solveLocalSpacers({
    physicalWindowHeight: budget.physicalWindowHeight,
    mountedRowsHeightEstimate: selection.mountedRowsHeightEstimate,
    capMode: budget.capMode,
    placement: resolveSpacerPlacement(input.kind, input.direction),
  })
  const items = candidateItems.slice(
    selection.startIndex,
    selection.endIndex + 1,
  )
  const renderWindow = {
    startIndex: selection.startIndex,
    endIndex: selection.endIndex,
    itemKeys: selection.itemKeys,
  }
  const role = budget.capMode === 'short-feed'
    ? 'short-feed'
    : resolveRole(input.kind, input.data.hasMoreAfter)
  const segment = createSegmentDraft({
    input,
    role,
    renderWindow,
    mountedRowsHeight: selection.mountedRowsHeightEstimate,
    physicalWindowHeight: budget.physicalWindowHeight,
    scrollHeightCap: budget.scrollHeightCap,
    capMode: budget.capMode,
    anchorKey: anchor?.key ?? selection.itemKeys[0] ?? EMPTY_SEGMENT_KEY,
  })

  return {
    segment,
    items,
    renderWindow,
    topSpacer: spacers.topSpacer,
    bottomSpacer: spacers.bottomSpacer,
    naturalBlankHeight: spacers.naturalBlankHeight,
    physicalWindowHeight: budget.physicalWindowHeight,
    mountedRowsHeightEstimate: selection.mountedRowsHeightEstimate,
    role,
    capMode: budget.capMode,
  }
}

export function deriveCommittedMetrics(
  input: MetricsDerivationInput,
): PhysicalScrollMetrics {
  const coverage = computeRealRowCoverage({
    topSpacer: input.topSpacer,
    mountedRowsHeight: input.mountedRowsHeight,
    clientHeight: input.viewportSize.clientHeight,
    scrollTop: input.scrollTop,
  })

  return {
    physicalSegmentId: input.segmentId,
    physicalSegmentRevision: input.segmentRevision,
    viewportSize: input.viewportSize.clientHeight,
    physicalWindowSize: input.physicalWindowHeight,
    domScrollHeight: input.physicalWindowHeight,
    scrollPosition: input.scrollTop,
    maxScrollPosition: Math.max(
      0,
      input.physicalWindowHeight - input.viewportSize.clientHeight,
    ),
    scrollHeightCap: input.scrollHeightCap,
    capMode: input.capMode,
    safeScrollRangeStart: coverage.safeScrollRangeStart,
    safeScrollRangeEnd: coverage.safeScrollRangeEnd,
    isDragLocked: input.flags?.isDragLocked ?? false,
    isThumbFrozen: input.flags?.isThumbFrozen ?? false,
    isSegmentShiftPending: input.flags?.isSegmentShiftPending ?? false,
    pendingShiftDirection: input.flags?.pendingShiftDirection ?? null,
    pendingEdgeOverflowPx: input.flags?.pendingEdgeOverflowPx ?? 0,
    isSegmentShifting: input.flags?.isSegmentShifting ?? false,
    isMomentumLatched: input.flags?.isMomentumLatched ?? false,
    suppressedMomentumDeltaPx: input.flags?.suppressedMomentumDeltaPx ?? 0,
    segmentRelayoutState: input.flags?.segmentRelayoutState ?? 'idle',
    segmentRelayoutReason: input.flags?.segmentRelayoutReason ?? null,
    adjacentPrefetchBefore: input.flags?.adjacentPrefetchBefore ?? 'idle',
    adjacentPrefetchAfter: input.flags?.adjacentPrefetchAfter ?? 'idle',
  }
}

function createSegmentDraft<TMessage, TOptimistic>(input: {
  readonly input: GeometryBuildInput<TMessage, TOptimistic>
  readonly role: PhysicalSegmentRole
  readonly renderWindow: {
    readonly itemKeys: readonly MessageRuntimeItemKey[]
  }
  readonly mountedRowsHeight: number
  readonly physicalWindowHeight: number
  readonly scrollHeightCap: number
  readonly capMode: PhysicalSegmentDraft['capMode']
  readonly anchorKey: MessageRuntimeItemKey
}): PhysicalSegmentDraft {
  const keys = input.renderWindow.itemKeys
  const startKey = keys[0] ?? EMPTY_SEGMENT_KEY
  const endKey = keys[keys.length - 1] ?? startKey
  const current = input.input.currentSegment
  const reuseCurrent =
    input.input.kind === 'segmentRelayout' && current !== undefined

  return {
    segmentId: reuseCurrent ? current.segmentId : undefined,
    logicalSegmentId: reuseCurrent
      ? current.logicalSegmentId
      : createLogicalSegmentId(input.role, startKey, endKey),
    logicalAnchorKey: reuseCurrent
      ? current.logicalAnchorKey
      : input.anchorKey,
    logicalStartItemKey: reuseCurrent
      ? current.logicalStartItemKey
      : startKey,
    logicalEndItemKey: reuseCurrent
      ? current.logicalEndItemKey
      : endKey,
    renderWindowStartKey: startKey,
    renderWindowEndKey: endKey,
    logicalRole: reuseCurrent ? current.logicalRole : input.role,
    estimatedRowsHeight: input.mountedRowsHeight,
    physicalWindowHeight: input.physicalWindowHeight,
    scrollHeightCap: input.scrollHeightCap,
    capMode: input.capMode,
  }
}

function resolveAnchor<TMessage, TOptimistic>(
  input: GeometryBuildInput<TMessage, TOptimistic>,
): AnchorState | null {
  const relayoutAnchor = resolveRelayoutAnchor(input)
  if (relayoutAnchor !== null) {
    return {
      key: relayoutAnchor,
      offsetWithinMessage: 0,
    }
  }

  if (input.target !== undefined) {
    return 'key' in input.target
      ? input.target
      : {
          key: anchorToCommittedItemKey(input.target),
          offsetWithinMessage: input.target.position ?? 0,
        }
  }

  if (input.kind === 'followBottom' || input.kind === 'bootstrap') {
    const latest = input.data.items[input.data.items.length - 1]
    return latest === undefined
      ? null
      : {
          key: latest.key,
          offsetWithinMessage: 0,
        }
  }

  return null
}

function resolveDirectionHint(
  kind: GeometryBuildKind,
  direction: 'before' | 'after' | undefined,
): PhysicalRowSelectionDirectionHint {
  if (kind === 'followBottom') {
    return 'latest'
  }
  if (kind === 'jump' || kind === 'restore') {
    return 'target'
  }
  if (kind === 'segmentRelayout') {
    return 'target'
  }

  return direction ?? 'latest'
}

function resolveSpacerPlacement(
  kind: GeometryBuildKind,
  direction: 'before' | 'after' | undefined,
): LocalSpacerPlacement {
  if (kind === 'followBottom' || direction === 'before') {
    return 'end'
  }
  if (kind === 'jump' || kind === 'restore') {
    return 'center'
  }

  return 'start'
}

function resolveRole(
  kind: GeometryBuildKind,
  hasMoreAfter: boolean,
): PhysicalSegmentRole {
  if (kind === 'followBottom' || (kind === 'bootstrap' && !hasMoreAfter)) {
    return 'latest'
  }
  if (kind === 'jump' || kind === 'restore') {
    return 'target'
  }

  return 'history'
}

function createLogicalSegmentId(
  role: PhysicalSegmentRole,
  startKey: MessageRuntimeItemKey,
  endKey: MessageRuntimeItemKey,
): string {
  return `${role}:${stringifyMessageRuntimeItemKey(startKey)}:${stringifyMessageRuntimeItemKey(endKey)}`
}
