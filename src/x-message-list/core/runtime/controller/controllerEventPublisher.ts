import type { MessageIdentityAnchor } from '../contracts/identity'
import type {
  MessageListRuntimeEvent,
  MessageListRuntimeEventListener,
  ViewportAnchorChangedEvent,
  ViewportDiagnosticRecord,
  ViewportObservationReason,
} from '../contracts/events'
import type { LoadedSegment } from '../contracts/segment'
import type {
  MessageListSnapshot,
  ProjectionCommitToken,
} from '../contracts/snapshot'
import type { DestinationIntent } from '../interactions/interactionState'
import type { RuntimeMeasurement } from '../dom/measurement'
import {
  resolveViewportAnchorEventInput,
  type ResolvedViewportAnchor,
  type ViewportAnchorEventInput,
} from '../dom/viewportAnchorEvents'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import { DiagnosticRingBuffer } from '../events/diagnostics'
import {
  createDestinationSettledEvent,
  createSegmentTrimPressureEvent,
  createViewportObservationEvent,
} from '../events/runtimePublicEvents'
import type { RuntimeScheduler } from '../contracts/options'

type PublisherHost<TMessage, TOptimistic> = {
  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic>
  getMeasurement(): RuntimeMeasurement
  resolveCurrentAnchor(): ResolvedViewportAnchor
  setLastAnchor(anchor: ResolvedViewportAnchor): void
}

/** Owns runtime event bookkeeping so the projection controller stays focused on transactions. */
export class ControllerEventPublisher<TMessage, TOptimistic> {
  private readonly diagnostics: DiagnosticRingBuffer
  private readonly listeners = new Set<MessageListRuntimeEventListener>()
  private lastObservationScrollTop = 0
  private readyGenerationKey: string | null = null

  constructor(
    scheduler: RuntimeScheduler,
    private readonly host: PublisherHost<TMessage, TOptimistic>,
  ) {
    this.diagnostics = new DiagnosticRingBuffer(scheduler)
  }

  subscribe(listener: MessageListRuntimeEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void { this.listeners.clear() }
  getDiagnostics(): ViewportDiagnosticRecord[] { return this.diagnostics.getRecords() }
  emit(event: MessageListRuntimeEvent): void { for (const listener of this.listeners) listener(event) }

  pushDiagnostic(
    name: string,
    severity: ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ): void {
    this.emit({ type: 'viewportDiagnostic', record: this.diagnostics.push(name, severity, details) })
  }

  emitAnchorChanged(
    reason: ViewportAnchorChangedEvent['reason'],
    input: ViewportAnchorEventInput,
  ): void {
    const resolved = this.resolveAnchor(input)
    this.host.setLastAnchor(resolved)
    const snapshot = this.host.getSnapshot()
    this.emit({
      type: 'viewportAnchorChanged',
      sessionId: snapshot.sessionId,
      generation: snapshot.generation,
      segmentRevision: snapshot.segmentRevision,
      reason,
      anchor: resolved.anchor,
      offsetWithinMessage: resolved.offsetWithinMessage,
    })
  }

  emitViewportObservation(
    reason: ViewportObservationReason,
    scrollSource: ScrollSource,
    input: ViewportAnchorEventInput,
  ): void {
    const measurement = this.host.getMeasurement()
    this.emit(createViewportObservationEvent({
      snapshot: this.host.getSnapshot(),
      measurement,
      reason,
      scrollSource,
      previousScrollTop: this.lastObservationScrollTop,
      anchor: this.resolveAnchor(input),
    }))
    this.lastObservationScrollTop = measurement.scrollTop
  }

  emitDestinationSettled(
    destination: DestinationIntent,
    resolvedTarget: MessageIdentityAnchor | null,
  ): void {
    this.emit(createDestinationSettledEvent({
      snapshot: this.host.getSnapshot(),
      destination,
      resolvedTarget,
    }))
  }

  emitViewportReadyOnce(token: ProjectionCommitToken): void {
    const key = `${token.sessionId}:${token.generation}`
    if (this.readyGenerationKey === key) return
    this.readyGenerationKey = key
    this.emit({ type: 'viewportReady', sessionId: token.sessionId, commitToken: token })
  }

  emitProjectionSettled(
    token: ProjectionCommitToken,
    status: 'applied' | 'commit-timeout' | 'motion-cancelled',
  ): void {
    this.emit({
      type: 'projectionSettled',
      sessionId: token.sessionId,
      generation: token.generation,
      segmentRevision: token.segmentRevision,
      commitToken: token,
      status,
    })
  }

  emitSegmentTrimPressure(
    segment: LoadedSegment<TMessage, TOptimistic>,
    anchor: MessageIdentityAnchor | null,
  ): void {
    const event = createSegmentTrimPressureEvent({
      snapshot: this.host.getSnapshot(),
      segment,
      anchor,
      measurement: this.host.getMeasurement(),
    })
    if (event) this.emit(event)
  }

  private resolveAnchor(input: ViewportAnchorEventInput): ResolvedViewportAnchor {
    return resolveViewportAnchorEventInput({
      eventInput: input,
      resolveCurrent: () => this.host.resolveCurrentAnchor(),
    })
  }
}
