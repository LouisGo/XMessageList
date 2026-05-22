import type { ScrollMotionOptions } from '../types'
import type { DestinationMotionForcedStart } from '../core/state/runtimeTypes'

export function getForcedDestinationStartTop(
  targetTop: number,
  forceAnimateFrom: DestinationMotionForcedStart | undefined,
  maxDistancePx: number,
): number | null {
  if (!forceAnimateFrom) {
    return null
  }

  return forceAnimateFrom === 'beforeTarget'
    ? Math.max(0, targetTop - maxDistancePx)
    : targetTop + maxDistancePx
}

export function getInstantDestinationMotionReason(
  options: Required<ScrollMotionOptions>,
  container: HTMLElement | null,
): 'disabled' | 'reduced-motion' | null {
  if (!options.enabled) {
    return 'disabled'
  }

  if (!options.respectReducedMotion) {
    return null
  }

  return isReducedMotionRequested(container) ? 'reduced-motion' : null
}

export function isReducedMotionRequested(container: HTMLElement | null): boolean {
  const ownerWindow = container?.ownerDocument.defaultView
  return Boolean(
    ownerWindow?.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
}
