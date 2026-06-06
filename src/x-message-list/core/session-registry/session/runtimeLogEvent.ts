import type {
  MessageListRuntimeEvent,
} from '../../runtime/index'
import type {
  MessageListRuntimeLogEvent,
} from '../contracts'

export function toSessionRuntimeLogEvent(
  event: MessageListRuntimeEvent,
): MessageListRuntimeLogEvent {
  if (event.type === 'viewportDiagnostic') {
    const sessionId = event.record.details.sessionId
    return {
      type: event.type,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      diagnostic: {
        name: event.record.name,
        severity: event.record.severity,
        timestamp: event.record.timestamp,
        details: event.record.details,
      },
    }
  }

  const base: MessageListRuntimeLogEvent = {
    type: event.type,
  }

  if ('sessionId' in event) base.sessionId = event.sessionId
  if ('generation' in event) base.generation = event.generation
  if ('segmentRevision' in event) base.segmentRevision = event.segmentRevision
  if ('requestToken' in event) base.requestToken = event.requestToken
  if ('reason' in event) base.reason = event.reason
  if ('edge' in event) base.edge = event.edge
  if ('target' in event) base.target = event.target
  if ('anchor' in event) base.anchor = event.anchor

  if (event.type === 'viewportReady') {
    base.details = { commitToken: event.commitToken }
  } else if (event.type === 'viewportError') {
    base.details = {
      code: event.code,
      message: event.message,
    }
  } else if (event.type === 'destinationSettled') {
    base.details = {
      intent: event.intent,
      resolution: event.resolution,
      resolvedTarget: event.resolvedTarget,
    }
  } else if (event.type === 'segmentTrimPressure') {
    base.details = {
      itemCount: event.itemCount,
      anchorKey: event.anchorKey,
      itemsBeforeAnchor: event.itemsBeforeAnchor,
      itemsAfterAnchor: event.itemsAfterAnchor,
      distanceBeforeAnchorPx: event.distanceBeforeAnchorPx,
      distanceAfterAnchorPx: event.distanceAfterAnchorPx,
      estimatedDomCost: event.estimatedDomCost,
      preferredTrimSide: event.preferredTrimSide,
    }
  } else if (event.type === 'viewportObservationChanged') {
    base.details = {
      reason: event.reason,
      scrollSource: event.scrollSource,
      direction: event.direction,
      activity: event.activity,
      offsetWithinMessage: event.offsetWithinMessage,
      visibleRange: event.visibleRange,
      visibleKeys: event.visibleKeys,
    }
  } else if (event.type === 'viewportAnchorChanged') {
    base.details = {
      reason: event.reason,
      offsetWithinMessage: event.offsetWithinMessage,
    }
  }

  return base
}
