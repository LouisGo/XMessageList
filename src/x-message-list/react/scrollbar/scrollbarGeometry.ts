import type { NativeScrollMetrics } from './scrollbarMetrics'

export const MIN_THUMB_SIZE = 32
export const TRACK_INSET_START = 4
const TRACK_INSET_END = 4

export function resolveScrollbarGeometry(metrics: NativeScrollMetrics) {
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  const visible = metrics.clientHeight > 0 && maxScrollTop > 1
  const trackHeight = Math.max(
    0,
    metrics.clientHeight - TRACK_INSET_START - TRACK_INSET_END,
  )
  const rawThumbHeight = metrics.scrollHeight > 0
    ? (metrics.clientHeight / metrics.scrollHeight) * trackHeight
    : trackHeight
  const thumbHeight = visible
    ? Math.min(trackHeight, Math.max(MIN_THUMB_SIZE, rawThumbHeight))
    : trackHeight
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const thumbTop = maxScrollTop > 0
    ? TRACK_INSET_START + (metrics.scrollTop / maxScrollTop) * maxThumbTop
    : TRACK_INSET_START

  return {
    visible,
    maxScrollTop,
    trackStart: TRACK_INSET_START,
    thumbHeight,
    thumbTop,
    maxThumbTop,
  }
}
