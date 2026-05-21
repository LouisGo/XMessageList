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

export type ScrollInteractionMode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'dragging' }
  | {
      readonly kind: 'drag-edge-pending'
      readonly direction: SegmentShiftDirection
      readonly overflowPx: number
    }
  | {
      readonly kind: 'drag-handoff'
      readonly direction: SegmentShiftDirection
      readonly overflowPx: number
    }
  | {
      readonly kind: 'wheel-latched'
      readonly direction: SegmentShiftDirection
      readonly suppressedDeltaPx: number
      readonly phase: 'waiting-data' | 'shifting'
    }
  | {
      readonly kind: 'segment-shift-pending'
      readonly direction: SegmentShiftDirection
      readonly overflowPx: number
    }
  | {
      readonly kind: 'segment-shift'
      readonly direction: SegmentShiftDirection | null
    }

export class ScrollInteractionState {
  #mode: ScrollInteractionMode = { kind: 'idle' }

  beginDrag(): void {
    this.#mode = { kind: 'dragging' }
  }

  endDrag(): void {
    if (
      this.#mode.kind === 'dragging' ||
      this.#mode.kind === 'drag-edge-pending'
    ) {
      this.#mode = { kind: 'idle' }
      return
    }
    if (this.#mode.kind === 'drag-handoff') {
      this.#mode = {
        kind: 'segment-shift',
        direction: this.#mode.direction,
      }
    }
  }

  markEdgePending(input: {
    readonly direction: SegmentShiftDirection
    readonly overflowPx: number
  }): void {
    if (
      this.#mode.kind === 'dragging' ||
      this.#mode.kind === 'drag-edge-pending'
    ) {
      this.#mode = {
        kind: 'drag-edge-pending',
        direction: input.direction,
        overflowPx: input.overflowPx,
      }
      return
    }
    if (this.#mode.kind === 'wheel-latched') return
    if (this.#mode.kind === 'drag-handoff') return

    this.#mode = {
      kind: 'segment-shift-pending',
      direction: input.direction,
      overflowPx: input.overflowPx,
    }
  }

  clearEdgePending(): void {
    if (this.#mode.kind === 'drag-edge-pending') {
      this.#mode = { kind: 'dragging' }
      return
    }
    if (this.#mode.kind === 'segment-shift-pending') {
      this.#mode = { kind: 'idle' }
    }
  }

  acceptDragHandoff(input: {
    readonly direction: SegmentShiftDirection
    readonly overflowPx: number
  }): void {
    this.#mode = {
      kind: 'drag-handoff',
      direction: input.direction,
      overflowPx: input.overflowPx,
    }
  }

  beginSegmentShift(input: {
    readonly direction: SegmentShiftDirection | null
  }): void {
    if (this.#mode.kind === 'drag-handoff') return
    if (
      this.#mode.kind === 'wheel-latched' &&
      this.#mode.direction === input.direction
    ) {
      this.#mode = {
        ...this.#mode,
        phase: 'shifting',
      }
      return
    }
    this.#mode = {
      kind: 'segment-shift',
      direction: input.direction,
    }
  }

  completeSegmentShift(): void {
    if (
      this.#mode.kind === 'drag-handoff' ||
      this.#mode.kind === 'drag-edge-pending'
    ) {
      this.#mode = { kind: 'dragging' }
      return
    }
    this.#mode = { kind: 'idle' }
  }

  abortSegmentShift(): void {
    this.completeSegmentShift()
  }

  latchMomentum(input: {
    readonly direction: SegmentShiftDirection
    readonly deltaPx: number
  }): void {
    this.#mode = {
      kind: 'wheel-latched',
      direction: input.direction,
      suppressedDeltaPx: Math.abs(input.deltaPx),
      phase: 'waiting-data',
    }
  }

  suppressMomentumDelta(input: {
    readonly direction: SegmentShiftDirection
    readonly deltaPx: number
  }): boolean {
    if (
      this.#mode.kind !== 'wheel-latched' ||
      this.#mode.direction !== input.direction
    ) {
      return false
    }
    this.#mode = {
      ...this.#mode,
      suppressedDeltaPx:
        this.#mode.suppressedDeltaPx + Math.abs(input.deltaPx),
    }
    return true
  }

  releaseMomentumLatch(): void {
    if (this.#mode.kind === 'wheel-latched') {
      this.#mode = { kind: 'idle' }
    }
  }

  isDragLocked(): boolean {
    return this.toFlags().isDragLocked
  }

  isThumbFrozen(): boolean {
    return this.toFlags().isThumbFrozen
  }

  isSegmentShiftInFlight(): boolean {
    const flags = this.toFlags()
    return flags.isSegmentShifting || flags.isSegmentShiftPending
  }

  isMomentumLatched(): boolean {
    return this.#mode.kind === 'wheel-latched'
  }

  getMomentumLatchDirection(): SegmentShiftDirection | null {
    return this.#mode.kind === 'wheel-latched'
      ? this.#mode.direction
      : null
  }

  toFlags(): ScrollInteractionFlags {
    switch (this.#mode.kind) {
      case 'idle':
        return idleFlags()
      case 'dragging':
        return {
          ...idleFlags(),
          isDragLocked: true,
        }
      case 'drag-edge-pending':
        return {
          ...idleFlags(),
          isDragLocked: true,
          isSegmentShiftPending: true,
          pendingShiftDirection: this.#mode.direction,
          pendingEdgeOverflowPx: this.#mode.overflowPx,
        }
      case 'drag-handoff':
        return {
          ...idleFlags(),
          isDragLocked: true,
          isThumbFrozen: true,
          isSegmentShiftPending: true,
          pendingShiftDirection: this.#mode.direction,
          pendingEdgeOverflowPx: this.#mode.overflowPx,
          isSegmentShifting: true,
        }
      case 'wheel-latched':
        return {
          ...idleFlags(),
          isSegmentShiftPending: true,
          pendingShiftDirection: this.#mode.direction,
          isSegmentShifting: this.#mode.phase === 'shifting',
          isMomentumLatched: true,
          suppressedMomentumDeltaPx: this.#mode.suppressedDeltaPx,
        }
      case 'segment-shift-pending':
        return {
          ...idleFlags(),
          isSegmentShiftPending: true,
          pendingShiftDirection: this.#mode.direction,
          pendingEdgeOverflowPx: this.#mode.overflowPx,
        }
      case 'segment-shift':
        return {
          ...idleFlags(),
          isSegmentShiftPending: true,
          pendingShiftDirection: this.#mode.direction,
          isSegmentShifting: true,
        }
    }
  }
}

function idleFlags(): ScrollInteractionFlags {
  return {
    isDragLocked: false,
    isThumbFrozen: false,
    isSegmentShiftPending: false,
    pendingShiftDirection: null,
    pendingEdgeOverflowPx: 0,
    isSegmentShifting: false,
    isMomentumLatched: false,
    suppressedMomentumDeltaPx: 0,
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
