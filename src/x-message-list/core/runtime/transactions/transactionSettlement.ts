import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { DestinationIntent } from '../interactions/interactionState'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { VisualAnchor } from '../dom/measurement'
import type { LoadedSegment } from '../contracts/segment'
import type { BottomLockState, MessageListSnapshot } from '../contracts/snapshot'
import type { MessageListMotionDirection } from '../contracts/options'
import type { ScrollMotionSource } from '../motion/motionCoordinator'

export type TransactionScrollResolution =
  | {
      kind: 'instant'
      anchor: MessageIdentityAnchor | null
      bottomLockState?: BottomLockState
    }
  | {
      kind: 'motion'
      source: ScrollMotionSource
      targetTop: number
      anchor: MessageIdentityAnchor | null
      bottomLockState: BottomLockState
      destination: DestinationIntent | null
      allowPreposition?: boolean
      directionHint?: MessageListMotionDirection
      enforceDirectionHint?: boolean
    }

/**
 * projection commit 后唯一决定滚动结算方式的入口：返回 instant correction，或把 motion 意图交给 controller 延后调度。
 */
export function settleTransactionScrollPosition<TMessage, TOptimistic>(options: {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  segment: LoadedSegment<TMessage, TOptimistic>
  capturedAnchor: VisualAnchor | null
  destination: DestinationIntent | null
  activeFollowBottom: boolean
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  correctAnchor: (
    anchor: VisualAnchor | null,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ) => MessageIdentityAnchor | null
  getViewportAnchor: () => MessageIdentityAnchor | null
}): TransactionScrollResolution {
  const {
    snapshot,
    segment,
    capturedAnchor,
    destination,
    activeFollowBottom,
    domInteractions,
    correctAnchor,
    getViewportAnchor,
  } = options

  if (destination && segment.modifier.type === 'reset-around') {
    // 显式 destination 优先：reset-around 的目标对齐语义高于普通锚点保持。
    return settleResetAround({
      snapshot,
      segment,
      destination,
      domInteractions,
      getViewportAnchor,
    })
  }

  if (segment.modifier.type === 'reset-around') {
    const target = segment.anchor ?? segment.modifier.target
    if (domInteractions.alignToMessage(
      snapshot,
      target,
      segment.modifier.align ?? 'center',
      segment.modifier.offsetWithinMessage,
    )) {
      return { kind: 'instant', anchor: target }
    }
    return { kind: 'instant', anchor: segment.anchor ?? getViewportAnchor() }
  }

  if (snapshot.pendingIntent === 'underflow-fill') {
    // underflow fill 是补齐可视范围，不应继承 bottom lock 去触发 follow-bottom motion。
    return { kind: 'instant', anchor: correctAnchor(capturedAnchor, segment) }
  }

  if (segment.modifier.type === 'append' && !segment.hasMoreAfter) {
    const shouldForceBottom = activeFollowBottom ||
      snapshot.pendingIntent === 'follow-bottom'

    if (segment.modifier.follow === 'follow' || shouldForceBottom) {
      // 源底部 append 且仍处于 follow 语义时，结算到真实 bottom，而不是保留旧视觉锚点。
      return settleBottomMotion(
        domInteractions,
        'followBottom',
        segment.anchor ?? getViewportAnchor(),
        {
          enforceDirectionHint: segment.modifier.follow === 'follow' &&
            !segment.modifier.retireKeys?.length,
        },
      )
    }

    return {
      kind: 'instant',
      anchor: correctAnchor(capturedAnchor, segment),
      bottomLockState: 'UNLOCKED',
    }
  }

  if (
    snapshot.pendingIntent === 'follow-bottom' &&
    segment.modifier.type === 'reset-latest' &&
    !segment.hasMoreAfter
  ) {
    return settleBottomMotion(
      domInteractions,
      'followBottom',
      segment.anchor ?? getViewportAnchor(),
      { enforceDirectionHint: true },
    )
  }

  if (segment.modifier.type === 'reset-latest') {
    if (!segment.hasMoreAfter) {
      if (snapshot.bottomLockState === 'LOCKED' || activeFollowBottom) {
        return settleBottomMotion(
          domInteractions,
          activeFollowBottom ? 'followBottom' : 'programmatic',
          segment.anchor ?? getViewportAnchor(),
          { enforceDirectionHint: activeFollowBottom },
        )
      }
      domInteractions.scrollToNativeBottom()
    }
    return { kind: 'instant', anchor: segment.anchor ?? getViewportAnchor() }
  }

  if (
    (snapshot.bottomLockState === 'LOCKED' || activeFollowBottom) &&
    !segment.hasMoreAfter
  ) {
    return settleBottomMotion(
      domInteractions,
      activeFollowBottom ? 'followBottom' : 'programmatic',
      segment.anchor ?? getViewportAnchor(),
      { enforceDirectionHint: false },
    )
  }

  return { kind: 'instant', anchor: correctAnchor(capturedAnchor, segment) }
}

function settleResetAround<TMessage, TOptimistic>(input: {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  segment: LoadedSegment<TMessage, TOptimistic>
  destination: DestinationIntent
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  getViewportAnchor: () => MessageIdentityAnchor | null
}): TransactionScrollResolution {
  const { snapshot, segment, destination, domInteractions, getViewportAnchor } = input
  const target = resolveDestinationAnchor(segment, destination)
  const targetScroll = target
    ? domInteractions.resolveAlignedScrollTarget(
        snapshot,
        target,
        destination.align,
        destination.offsetWithinMessage,
      )
    : null

  if (!target || !targetScroll) {
    return { kind: 'instant', anchor: segment.anchor ?? getViewportAnchor() }
  }

  if (destination.reason === 'restore') {
    domInteractions.writeProgrammaticScroll(targetScroll.container, targetScroll.scrollTop, 'programmatic')
    return { kind: 'instant', anchor: target }
  }

  return {
    kind: 'motion',
    source: 'jump',
    targetTop: targetScroll.scrollTop,
    anchor: target,
    bottomLockState: 'UNLOCKED',
    destination,
    allowPreposition: !destination.motion?.crossSession,
    directionHint: destination.motion?.crossSession ? undefined : destination.motion?.direction,
    enforceDirectionHint: Boolean(
      !destination.motion?.crossSession &&
      destination.motion?.direction &&
      destination.motion.direction !== 'none',
    ),
  }
}

function settleBottomMotion<TMessage, TOptimistic>(
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>,
  source: Extract<ScrollMotionSource, 'programmatic' | 'followBottom'>,
  anchor: MessageIdentityAnchor | null,
  options: { enforceDirectionHint?: boolean } = {},
): TransactionScrollResolution {
  const targetTop = domInteractions.getBottomTargetTop()

  if (targetTop === null) {
    return { kind: 'instant', anchor }
  }

  return {
    kind: 'motion',
    source,
    targetTop,
    anchor,
    bottomLockState: 'LOCKED',
    destination: null,
    directionHint: source === 'followBottom' ? 'after' : undefined,
    enforceDirectionHint: source === 'followBottom' &&
      options.enforceDirectionHint === true,
  }
}

function resolveDestinationAnchor<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  destination: DestinationIntent,
): MessageIdentityAnchor | null {
  if (segment.modifier.type !== 'reset-around') {
    return null
  }

  if (destination.reason === 'jump' && segment.anchorStatus === 'deleted') {
    return segment.anchor ?? destination.target
  }

  return segment.anchor ?? destination.target
}
