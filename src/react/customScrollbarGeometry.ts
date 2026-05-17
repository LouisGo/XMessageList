export type CustomScrollbarMetrics = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export type CustomScrollbarGeometryOptions = {
  trackInsetStart?: number
  trackInsetEnd?: number
  minThumbLength?: number
}

export type CustomScrollbarGeometry = {
  scrollable: boolean
  trackStart: number
  trackLength: number
  thumbTop: number
  thumbLength: number
  maxScrollTop: number
}

const defaultGeometryOptions = {
  trackInsetStart: 4,
  trackInsetEnd: 4,
  minThumbLength: 32,
} satisfies Required<CustomScrollbarGeometryOptions>

export function computeCustomScrollbarGeometry(
  metrics: CustomScrollbarMetrics,
  options: CustomScrollbarGeometryOptions = {},
): CustomScrollbarGeometry {
  const trackInsetStart =
    options.trackInsetStart ?? defaultGeometryOptions.trackInsetStart
  const trackInsetEnd =
    options.trackInsetEnd ?? defaultGeometryOptions.trackInsetEnd
  const minThumbLength =
    options.minThumbLength ?? defaultGeometryOptions.minThumbLength
  const clientHeight = Math.max(0, metrics.clientHeight)
  const scrollHeight = Math.max(0, metrics.scrollHeight)
  const trackLength = Math.max(0, clientHeight - trackInsetStart - trackInsetEnd)
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)

  if (clientHeight <= 0 || trackLength <= 0 || maxScrollTop <= 0) {
    return {
      scrollable: false,
      trackStart: trackInsetStart,
      trackLength,
      thumbTop: trackInsetStart,
      thumbLength: 0,
      maxScrollTop,
    }
  }

  const rawThumbLength = trackLength * (clientHeight / scrollHeight)
  const thumbLength = Math.min(
    trackLength,
    Math.max(minThumbLength, rawThumbLength),
  )
  const availableThumbTravel = Math.max(0, trackLength - thumbLength)
  const normalizedScrollTop = Math.min(
    1,
    Math.max(0, metrics.scrollTop / maxScrollTop),
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
