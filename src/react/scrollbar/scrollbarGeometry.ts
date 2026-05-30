import type { NativeScrollMetrics } from './scrollbarMetrics'

export const MIN_THUMB_SIZE = 28

export function resolveScrollbarGeometry(metrics: NativeScrollMetrics) {
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  const visible = metrics.clientHeight > 0 && maxScrollTop > 1
  const trackHeight = Math.max(0, metrics.clientHeight)
  const rawThumbHeight = metrics.scrollHeight > 0
    ? (metrics.clientHeight / metrics.scrollHeight) * trackHeight
    : trackHeight
  const thumbHeight = visible
    ? Math.min(trackHeight, Math.max(MIN_THUMB_SIZE, rawThumbHeight))
    : trackHeight
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const thumbTop = maxScrollTop > 0
    ? (metrics.scrollTop / maxScrollTop) * maxThumbTop
    : 0

  return {
    visible,
    maxScrollTop,
    thumbHeight,
    thumbTop,
    maxThumbTop,
  }
}
