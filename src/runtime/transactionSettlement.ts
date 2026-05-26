import type { RuntimeDomInteractions } from './domInteractions'
import type { DestinationIntent } from './interactionState'
import type { MessageIdentityAnchor } from './identity'
import type { VisualAnchor } from './measurement'
import type { LoadedSegment } from './segment'
import type { MessageListSnapshot } from './snapshot'

export function settleTransactionScrollPosition<TMessage, TOptimistic>(options: {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  segment: LoadedSegment<TMessage, TOptimistic>
  capturedAnchor: VisualAnchor | null
  destination: DestinationIntent | null
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  correctAnchor: (
    anchor: VisualAnchor | null,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ) => MessageIdentityAnchor | null
  getViewportAnchor: () => MessageIdentityAnchor | null
}): MessageIdentityAnchor | null {
  const {
    snapshot,
    segment,
    capturedAnchor,
    destination,
    domInteractions,
    correctAnchor,
    getViewportAnchor,
  } = options

  if (
    destination &&
    segment.modifier.type === 'reset-around' &&
    domInteractions.alignToMessage(snapshot, destination.target, destination.align)
  ) {
    return destination.target
  }

  if (
    snapshot.pendingIntent === 'follow-bottom' &&
    segment.modifier.type === 'reset-latest' &&
    !segment.hasMoreAfter
  ) {
    domInteractions.scrollToNativeBottom()
    return segment.anchor ?? getViewportAnchor()
  }

  if (segment.modifier.type === 'reset-latest') {
    if (!segment.hasMoreAfter) {
      domInteractions.scrollToNativeBottom()
    }
    return segment.anchor ?? getViewportAnchor()
  }

  if (segment.modifier.type === 'reset-around') {
    const target = segment.modifier.target ?? segment.anchor

    if (
      target &&
      domInteractions.alignToMessage(snapshot, target, 'center')
    ) {
      return target
    }

    return segment.anchor ?? getViewportAnchor()
  }

  if (snapshot.bottomLockState === 'LOCKED' && !segment.hasMoreAfter) {
    domInteractions.scrollToNativeBottom()
    return segment.anchor ?? getViewportAnchor()
  }

  return correctAnchor(capturedAnchor, segment)
}
