import type { PhysicalScrollMetrics } from '../geometry/types'

export type RuntimeNextScrollbarGeometryOptions = {
  readonly trackInsetStart?: number
  readonly trackInsetEnd?: number
  readonly minThumbLength?: number
}

export type RuntimeNextScrollbarGeometry = {
  readonly scrollable: boolean
  readonly trackStart: number
  readonly trackLength: number
  readonly thumbTop: number
  readonly thumbLength: number
  readonly maxScrollTop: number
}

const defaultOptions = {
  trackInsetStart: 4,
  trackInsetEnd: 4,
  minThumbLength: 32,
} satisfies Required<RuntimeNextScrollbarGeometryOptions>

export function computeRuntimeNextScrollbarGeometry(
  metrics: PhysicalScrollMetrics,
  options: RuntimeNextScrollbarGeometryOptions = {},
): RuntimeNextScrollbarGeometry {
  const trackInsetStart = options.trackInsetStart ?? defaultOptions.trackInsetStart
  const trackInsetEnd = options.trackInsetEnd ?? defaultOptions.trackInsetEnd
  const minThumbLength = options.minThumbLength ?? defaultOptions.minThumbLength
  const viewportSize = Math.max(0, metrics.viewportSize)
  const physicalWindowSize = Math.max(0, metrics.physicalWindowSize)
  const trackLength = Math.max(0, viewportSize - trackInsetStart - trackInsetEnd)
  const maxScrollTop = Math.max(0, metrics.maxScrollPosition)

  if (
    viewportSize <= 0 ||
    physicalWindowSize <= 0 ||
    trackLength <= 0 ||
    maxScrollTop <= 0
  ) {
    return {
      scrollable: false,
      trackStart: trackInsetStart,
      trackLength,
      thumbTop: trackInsetStart,
      thumbLength: trackLength,
      maxScrollTop,
    }
  }

  const rawThumbLength = trackLength * viewportSize / physicalWindowSize
  const thumbLength = Math.min(
    trackLength,
    Math.max(minThumbLength, rawThumbLength),
  )
  const availableThumbTravel = Math.max(0, trackLength - thumbLength)
  const normalizedScrollTop = Math.min(
    1,
    Math.max(0, metrics.scrollPosition / maxScrollTop),
  )

  return {
    scrollable: true,
    trackStart: trackInsetStart,
    trackLength,
    thumbTop: trackInsetStart + availableThumbTravel * normalizedScrollTop,
    thumbLength,
    maxScrollTop,
  }
}
