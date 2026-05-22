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

export type ScrollbarPointerInput = {
  pointerY: number
  trackTop: number
  grabOffset: number
  geometry: CustomScrollbarGeometry
  fallbackScrollTop: number
}

export type ScrollbarTrackPageInput = {
  clickY: number
  scrollTop: number
  clientHeight: number
  geometry: CustomScrollbarGeometry
  pageInset?: number
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

export function getScrollTopForScrollbarPointer(
  input: ScrollbarPointerInput,
): number {
  const { pointerY, trackTop, grabOffset, geometry, fallbackScrollTop } = input

  if (!geometry.scrollable) {
    return fallbackScrollTop
  }

  const availableTravel = getAvailableThumbTravel(geometry)
  if (availableTravel <= 0 || geometry.maxScrollTop <= 0) {
    return 0
  }

  const rawThumbTop = pointerY - trackTop - grabOffset
  const thumbTop = Math.min(
    geometry.trackStart + availableTravel,
    Math.max(geometry.trackStart, rawThumbTop),
  )
  const progress = (thumbTop - geometry.trackStart) / availableTravel

  return progress * geometry.maxScrollTop
}

export function getScrollbarPointerOverflowDirection(
  pointerY: number,
  trackTop: number,
  geometry: CustomScrollbarGeometry,
): 'before' | 'after' | null {
  if (!geometry.scrollable) {
    return null
  }

  const pointerTrackY = pointerY - trackTop
  const minThumbTop = geometry.trackStart
  const maxThumbTop = geometry.trackStart + getAvailableThumbTravel(geometry)

  if (pointerTrackY < minThumbTop) {
    return 'before'
  }

  if (pointerTrackY > maxThumbTop + geometry.thumbLength) {
    return 'after'
  }

  return null
}

export function getScrollbarTrackPageScrollTop(
  input: ScrollbarTrackPageInput,
): number {
  const pageInset = input.pageInset ?? 32
  const viewportPage = Math.max(1, input.clientHeight - pageInset)
  const thumbStart = input.geometry.thumbTop
  const thumbEnd = thumbStart + input.geometry.thumbLength

  if (input.clickY >= thumbStart && input.clickY <= thumbEnd) {
    return input.scrollTop
  }

  return input.clickY < thumbStart
    ? Math.max(0, input.scrollTop - viewportPage)
    : Math.min(input.geometry.maxScrollTop, input.scrollTop + viewportPage)
}

function getAvailableThumbTravel(geometry: CustomScrollbarGeometry): number {
  return Math.max(0, geometry.trackLength - geometry.thumbLength)
}
