import type { LoadedSegment } from './segment'
import type { MessageListSnapshot } from './snapshot'

export function removeQueuedSegmentsBeforeGeneration<TMessage, TOptimistic>(
  queue: Array<LoadedSegment<TMessage, TOptimistic>>,
  generation: number,
): void {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index].generation < generation) {
      queue.splice(index, 1)
    }
  }
}

export function isStaleLoadedSegment<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  latestSegment: LoadedSegment<TMessage, TOptimistic> | undefined,
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
): boolean {
  const latestGeneration = latestSegment?.generation ?? snapshot.generation
  const latestSegmentRevision = latestSegment?.segmentRevision ??
    snapshot.segmentRevision

  return segment.generation < latestGeneration ||
    (
      segment.generation === latestGeneration &&
      segment.segmentRevision <= latestSegmentRevision
    )
}
