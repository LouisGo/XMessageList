import type { MutableRefObject } from 'react'
import type { MessageListAdapterRuntime } from '../../core/runtime/internal'

export type NativeScrollMetrics = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export const EMPTY_METRICS: NativeScrollMetrics = {
  scrollTop: 0,
  clientHeight: 0,
  scrollHeight: 0,
}

const METRIC_MISMATCH_TOLERANCE = 2

export function readMetrics(container: HTMLElement | null): NativeScrollMetrics {
  if (!container) {
    return EMPTY_METRICS
  }

  return {
    scrollTop: container.scrollTop,
    clientHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
  }
}

export function areSameMetrics(
  left: NativeScrollMetrics,
  right: NativeScrollMetrics,
): boolean {
  return left.scrollTop === right.scrollTop &&
    left.clientHeight === right.clientHeight &&
    left.scrollHeight === right.scrollHeight
}

export function areSameMetricRange(
  left: NativeScrollMetrics,
  right: NativeScrollMetrics,
): boolean {
  return left.clientHeight === right.clientHeight &&
    left.scrollHeight === right.scrollHeight
}

export function createDragMetricsKey(
  projectionRevision: number,
  metrics: NativeScrollMetrics,
): string {
  return [
    projectionRevision,
    metrics.clientHeight,
    metrics.scrollHeight,
  ].join(':')
}

export function reportMetricMismatch<TMessage, TOptimistic>(
  runtime: MessageListAdapterRuntime<TMessage, TOptimistic>,
  metrics: NativeScrollMetrics,
  lastMismatchKey: MutableRefObject<string | null>,
): void {
  const evidence = runtime.getEvidence()
  const clientHeightDelta = Math.abs(evidence.clientHeight - metrics.clientHeight)
  const scrollHeightDelta = Math.abs(evidence.scrollHeight - metrics.scrollHeight)

  if (
    clientHeightDelta > METRIC_MISMATCH_TOLERANCE ||
    scrollHeightDelta > METRIC_MISMATCH_TOLERANCE
  ) {
    const mismatchKey = [
      clientHeightDelta,
      scrollHeightDelta,
      metrics.clientHeight,
      metrics.scrollHeight,
    ].join(':')

    if (lastMismatchKey.current === mismatchKey) {
      return
    }

    lastMismatchKey.current = mismatchKey
    runtime.reportOverlayMetricMismatch({
      clientHeightDelta,
      scrollHeightDelta,
      evidenceClientHeight: evidence.clientHeight,
      evidenceScrollHeight: evidence.scrollHeight,
      overlayClientHeight: metrics.clientHeight,
      overlayScrollHeight: metrics.scrollHeight,
    })
    return
  }

  lastMismatchKey.current = null
}
