import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { DestinationIntent } from '../interactions/interactionState'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { VisualAnchor } from '../dom/measurement'
import type { LoadedSegment } from '../contracts/segment'
import type { BottomLockState, MessageListSnapshot } from '../contracts/snapshot'
import type { ScrollMotionSource } from '../motion/motionCoordinator'

export type TransactionScrollResolution =
  | { kind: 'instant'; anchor: MessageIdentityAnchor | null }
  | {
      kind: 'motion'
      source: ScrollMotionSource
      targetTop: number
      anchor: MessageIdentityAnchor | null
      bottomLockState: BottomLockState
      destination: DestinationIntent | null
      allowPreposition?: boolean
    }

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

  if (
    snapshot.pendingIntent === 'follow-bottom' &&
    segment.modifier.type === 'reset-latest' &&
    !segment.hasMoreAfter
  ) {
    return settleBottomMotion(domInteractions, 'followBottom', segment.anchor ?? getViewportAnchor())
  }

  if (segment.modifier.type === 'reset-latest') {
    if (!segment.hasMoreAfter) {
      if (snapshot.bottomLockState === 'LOCKED' || activeFollowBottom) {
        return settleBottomMotion(
          domInteractions,
          activeFollowBottom ? 'followBottom' : 'programmatic',
          segment.anchor ?? getViewportAnchor(),
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
    domInteractions.writeProgrammaticScroll(targetScroll.container, targetScroll.scrollTop, 'jump')
    return { kind: 'instant', anchor: target }
  }

  return {
    kind: 'motion',
    source: 'jump',
    targetTop: targetScroll.scrollTop,
    anchor: target,
    bottomLockState: 'UNLOCKED',
    destination,
    allowPreposition: !destination.motion?.crossFeed,
  }
}

function settleBottomMotion<TMessage, TOptimistic>(
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>,
  source: Extract<ScrollMotionSource, 'programmatic' | 'followBottom'>,
  anchor: MessageIdentityAnchor | null,
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
