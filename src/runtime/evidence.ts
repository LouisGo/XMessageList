import type { RuntimeMeasurement } from './measurement'
import type {
  MessageListSnapshot,
  ProjectionCommitToken,
  ViewportEvidence,
} from './snapshot'

export function createViewportEvidence<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  measurement: RuntimeMeasurement,
  pendingToken: ProjectionCommitToken | null,
): ViewportEvidence {
  return {
    feedId: snapshot.feedId,
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
    ...measurement,
  }
}
