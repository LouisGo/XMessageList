import type { ScrollFrameMetrics } from '../state/runtimeTypes'

export function readScrollFrameMetrics(
  container: HTMLElement,
): ScrollFrameMetrics {
  const scrollTop = container.scrollTop
  const clientHeight = container.clientHeight
  const scrollHeight = container.scrollHeight

  return {
    scrollTop,
    clientHeight,
    clientWidth: container.clientWidth,
    scrollHeight,
    distanceToBottom: Math.max(0, scrollHeight - scrollTop - clientHeight),
  }
}
