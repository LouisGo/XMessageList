import type {
  PhysicalScrollMetrics,
  SegmentShiftDirection,
} from '../geometry/types'

export type ScrollInteractionFlags = Pick<
  PhysicalScrollMetrics,
  | 'isDragLocked'
  | 'isThumbFrozen'
  | 'isSegmentShiftPending'
  | 'pendingShiftDirection'
  | 'pendingEdgeOverflowPx'
  | 'isSegmentShifting'
  | 'isMomentumLatched'
  | 'suppressedMomentumDeltaPx'
>

export type DirectScrollBoundaryDecision =
  | {
      readonly kind: 'inside'
      readonly scrollTop: number
    }
  | {
      readonly kind: 'boundary'
      readonly scrollTop: number
      readonly direction: SegmentShiftDirection
      readonly overflowPx: number
    }

export class ScrollInteractionState {
  #isDragLocked = false
  #isThumbFrozen = false
  #isSegmentShiftPending = false
  #pendingShiftDirection: SegmentShiftDirection | null = null
  #pendingEdgeOverflowPx = 0
  #isSegmentShifting = false
  #isMomentumLatched = false
  #momentumLatchDirection: SegmentShiftDirection | null = null
  #suppressedMomentumDeltaPx = 0

  beginDrag(): void {
    this.#isDragLocked = true
    this.#isThumbFrozen = false
  }

  endDrag(): void {
    this.#isDragLocked = false
  }

  markEdgePending(input: {
    readonly direction: SegmentShiftDirection
    readonly overflowPx: number
  }): void {
    this.#isSegmentShiftPending = true
    this.#pendingShiftDirection = input.direction
    this.#pendingEdgeOverflowPx = input.overflowPx
  }

  clearEdgePending(): void {
    if (this.#isSegmentShifting || this.#isThumbFrozen) return
    this.#isSegmentShiftPending = false
    this.#pendingShiftDirection = null
    this.#pendingEdgeOverflowPx = 0
  }

  acceptDragHandoff(input: {
    readonly direction: SegmentShiftDirection
    readonly overflowPx: number
  }): void {
    this.#isThumbFrozen = true
    this.#isSegmentShiftPending = true
    this.#isSegmentShifting = true
    this.#pendingShiftDirection = input.direction
    this.#pendingEdgeOverflowPx = input.overflowPx
  }

  beginSegmentShift(input: {
    readonly direction: SegmentShiftDirection | null
  }): void {
    this.#isSegmentShifting = true
    this.#isSegmentShiftPending = true
    this.#pendingShiftDirection = input.direction
  }

  completeSegmentShift(): void {
    this.#isThumbFrozen = false
    this.#isSegmentShiftPending = false
    this.#pendingShiftDirection = null
    this.#pendingEdgeOverflowPx = 0
    this.#isSegmentShifting = false
    this.#isMomentumLatched = false
    this.#momentumLatchDirection = null
    this.#suppressedMomentumDeltaPx = 0
  }

  abortSegmentShift(): void {
    this.#isThumbFrozen = false
    this.#isSegmentShiftPending = false
    this.#pendingShiftDirection = null
    this.#pendingEdgeOverflowPx = 0
    this.#isSegmentShifting = false
    this.#isMomentumLatched = false
    this.#momentumLatchDirection = null
    this.#suppressedMomentumDeltaPx = 0
  }

  latchMomentum(input: {
    readonly direction: SegmentShiftDirection
    readonly deltaPx: number
  }): void {
    this.#isMomentumLatched = true
    this.#momentumLatchDirection = input.direction
    this.#isSegmentShiftPending = true
    this.#pendingShiftDirection = input.direction
    this.#suppressedMomentumDeltaPx += Math.abs(input.deltaPx)
  }

  suppressMomentumDelta(input: {
    readonly direction: SegmentShiftDirection
    readonly deltaPx: number
  }): boolean {
    if (this.#momentumLatchDirection !== input.direction) return false
    this.#suppressedMomentumDeltaPx += Math.abs(input.deltaPx)
    return true
  }

  releaseMomentumLatch(): void {
    this.#isMomentumLatched = false
    this.#momentumLatchDirection = null
    this.#suppressedMomentumDeltaPx = 0
  }

  isDragLocked(): boolean {
    return this.#isDragLocked
  }

  isThumbFrozen(): boolean {
    return this.#isThumbFrozen
  }

  isSegmentShiftInFlight(): boolean {
    return this.#isSegmentShifting || this.#isSegmentShiftPending
  }

  isMomentumLatched(): boolean {
    return this.#isMomentumLatched
  }

  getMomentumLatchDirection(): SegmentShiftDirection | null {
    return this.#momentumLatchDirection
  }

  toFlags(): ScrollInteractionFlags {
    return {
      isDragLocked: this.#isDragLocked,
      isThumbFrozen: this.#isThumbFrozen,
      isSegmentShiftPending: this.#isSegmentShiftPending,
      pendingShiftDirection: this.#pendingShiftDirection,
      pendingEdgeOverflowPx: this.#pendingEdgeOverflowPx,
      isSegmentShifting: this.#isSegmentShifting,
      isMomentumLatched: this.#isMomentumLatched,
      suppressedMomentumDeltaPx: this.#suppressedMomentumDeltaPx,
    }
  }
}

export function resolveDirectScrollBoundary(input: {
  readonly desiredScrollTop: number
  readonly safeScrollRangeStart: number
  readonly safeScrollRangeEnd: number
  readonly maxScrollPosition: number
}): DirectScrollBoundaryDecision {
  const maxScrollPosition = toFiniteNonNegativePx(input.maxScrollPosition)
  const rangeStart = Math.min(
    maxScrollPosition,
    toFiniteNonNegativePx(input.safeScrollRangeStart),
  )
  const rangeEnd = Math.min(
    maxScrollPosition,
    Math.max(rangeStart, toFiniteNonNegativePx(input.safeScrollRangeEnd)),
  )
  const desired = Number.isFinite(input.desiredScrollTop)
    ? input.desiredScrollTop
    : rangeStart

  if (desired < rangeStart) {
    return {
      kind: 'boundary',
      direction: 'before',
      overflowPx: rangeStart - desired,
      scrollTop: rangeStart,
    }
  }

  if (desired > rangeEnd) {
    return {
      kind: 'boundary',
      direction: 'after',
      overflowPx: desired - rangeEnd,
      scrollTop: rangeEnd,
    }
  }

  return {
    kind: 'inside',
    scrollTop: desired,
  }
}

function toFiniteNonNegativePx(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
