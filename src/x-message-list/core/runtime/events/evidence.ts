import type { RuntimeMeasurement } from '../dom/measurement'
import type {
  MessageListSnapshot,
  ProjectionCommitToken,
  ViewportEvidence,
} from '../contracts/snapshot'

export function createViewportEvidence<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  measurement: RuntimeMeasurement,
  pendingToken: ProjectionCommitToken | null,
): ViewportEvidence {
  return {
    sessionId: snapshot.sessionId,
    generation: snapshot.generation,
    segmentRevision: snapshot.segmentRevision,
    projectionRevision: snapshot.projectionRevision,
    commitToken: pendingToken ?? snapshot.commitToken,
    modifier: snapshot.segmentMeta.modifier.type,
    hasMoreBefore: snapshot.segmentMeta.hasMoreBefore,
    hasMoreAfter: snapshot.segmentMeta.hasMoreAfter,
    bottomLockState: snapshot.bottomLockState,
    pendingIntent: snapshot.pendingIntent,
    shortSegmentAlignment: snapshot.segmentMeta.shortSegmentAlignment,
    phase: snapshot.viewportPhase,
    edgeState: snapshot.edgeState,
    scrollTop: measurement.scrollTop,
    clientHeight: measurement.clientHeight,
    scrollHeight: measurement.scrollHeight,
    visibleRows: measurement.visibleRows,
    beforeTrigger: measurement.beforeTrigger,
    afterTrigger: measurement.afterTrigger,
    bottomMarker: measurement.bottomMarker,
  }
}
