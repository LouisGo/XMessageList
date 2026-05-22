import type { MessageDataSnapshot, ScrollMotionOptions } from '../types'
import type { RuntimeDiagnosticEmitter } from '../core/state/runtimeTypes'
import type { ScrollMotionSource } from './scrollMotionEngine'
import { isReducedMotionRequested } from './destinationMotionPolicy'

export function createDestinationMotionCorrelationId<TMessage, TOptimistic>(
  source: ScrollMotionSource,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
): string {
  return `motion:${source}:${data.feedId}:${data.generation}:${data.revision}`
}

export function emitDestinationMotionStartDiagnostic<TMessage, TOptimistic>(
  input: {
    emitDiagnostic: RuntimeDiagnosticEmitter
    source: ScrollMotionSource
    data: MessageDataSnapshot<TMessage, TOptimistic>
    container: HTMLElement
    targetTop: number
    forcedStartTop: number | null
    instantReason: 'disabled' | 'reduced-motion' | null
    options: Required<ScrollMotionOptions>
    correlationId: string
  },
): void {
  input.emitDiagnostic({
    channel: 'motion',
    severity: 'info',
    name: 'destinationMotion.start',
    correlationId: input.correlationId,
    details: () => ({
      source: input.source,
      decision: input.instantReason ? 'instant' : 'engine',
      instantReason: input.instantReason,
      currentTop: input.container.scrollTop,
      targetTop: input.targetTop,
      distancePx: input.targetTop - input.container.scrollTop,
      forcedStartTop: input.forcedStartTop,
      scrollHeight: input.container.scrollHeight,
      clientHeight: input.container.clientHeight,
      enabled: input.options.enabled,
      respectReducedMotion: input.options.respectReducedMotion,
      reducedMotion: isReducedMotionRequested(input.container),
    }),
  })
}
