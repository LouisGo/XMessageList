import { DiagnosticRingBuffer } from './diagnostics'
import { RuntimeDomRegistry } from './domRegistry'
import type { MessageIdentityAnchor, MessageRuntimeItemKey } from './identity'
import type { MessageListAdapterRuntime } from './internal'
import type {
  MessageListRuntimeEventListener,
  ViewportObservationListener,
} from './events'
import type { LoadedSegment } from './segment'
import { createDefaultScheduler } from './scheduler'
import {
  captureVisualAnchor,
  measureRuntimeDom,
  type VisualAnchor,
} from './measurement'
import type {
  MessageListRuntimeOptions,
  RuntimeScheduler,
} from './options'
import type {
  MessageListSnapshot,
  MessageListSnapshotListener,
  ProjectionCommitToken,
  ViewportEvidence,
} from './snapshot'

type PendingTransaction<TMessage, TOptimistic> = {
  token: ProjectionCommitToken
  segment: LoadedSegment<TMessage, TOptimistic>
  anchor: VisualAnchor | null
  timeoutHandle: number
}

export class MessageListRuntimeController<TMessage = unknown, TOptimistic = unknown>
  implements MessageListAdapterRuntime<TMessage, TOptimistic> {
  private readonly scheduler: RuntimeScheduler
  private readonly registry = new RuntimeDomRegistry()
  private readonly diagnostics: DiagnosticRingBuffer
  private readonly snapshotListeners = new Set<MessageListSnapshotListener>()
  private readonly eventListeners = new Set<MessageListRuntimeEventListener>()
  private snapshot: MessageListSnapshot<TMessage, TOptimistic>
  private pendingTransaction: PendingTransaction<TMessage, TOptimistic> | null = null
  private lastMeasurement = measureRuntimeDom(this.registry.snapshot())
  private lastAnchor: MessageIdentityAnchor | null = null
  private readonly resizeObserver: ResizeObserver | null = null
  private resizeFrame: number | null = null

  constructor(private readonly options: MessageListRuntimeOptions) {
    this.scheduler = options.scheduler ?? createDefaultScheduler()
    this.diagnostics = new DiagnosticRingBuffer(this.scheduler)
    this.snapshot = createInitialSnapshot<TMessage, TOptimistic>(
      options.feedId ?? 'default',
    )
    this.resizeObserver = options.observers?.createResizeObserver(() => {
      this.scheduleResizeMeasurement()
    }) ?? null
  }

  attachScrollContainer(container: HTMLElement): void {
    this.registry.setScrollContainer(container)
  }

  detachScrollContainer(): void {
    this.lastAnchor = this.getViewportAnchor()
    this.registry.setScrollContainer(null)
    this.registry.clearRows()
  }

  destroy(): void {
    if (this.pendingTransaction) {
      this.scheduler.clearTimeout(this.pendingTransaction.timeoutHandle)
    }
    if (this.resizeFrame !== null) {
      this.scheduler.cancelAnimationFrame(this.resizeFrame)
    }
    this.resizeObserver?.disconnect()
    this.pendingTransaction = null
    this.resizeFrame = null
    this.snapshotListeners.clear()
    this.eventListeners.clear()
  }

  applyLoadedSegment(segment: LoadedSegment<TMessage, TOptimistic>): void {
    if (segment.generation < this.snapshot.generation) {
      this.pushDiagnostic('transaction.staleSegment', 'warn', {
        segmentGeneration: segment.generation,
        currentGeneration: this.snapshot.generation,
      })
      return
    }

    const projectionRevision = this.snapshot.projectionRevision + 1
    const token = {
      feedId: segment.feedId,
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      projectionRevision,
    }
    const anchor = captureVisualAnchor(this.registry.snapshot())
    const timeoutHandle = this.scheduler.setTimeout(() => {
      this.pendingTransaction = null
      this.pushDiagnostic('transaction.commitTimeout', 'error', token)
      this.setViewportPhase('IDLE')
    }, this.options.commitTimeoutMs ?? 120)

    this.pendingTransaction = { token, segment, anchor, timeoutHandle }
    this.snapshot = createSnapshotFromSegment(segment, {
      previous: this.snapshot,
      projectionRevision,
      viewportPhase: 'PROJECTING',
    })
    this.emitSnapshot()
  }

  ackProjectionCommit(token: ProjectionCommitToken): void {
    const pending = this.pendingTransaction

    if (!pending || !isSameToken(pending.token, token)) {
      if (!pending && isSameToken(this.snapshot.commitToken, token)) {
        return
      }

      this.pushDiagnostic('transaction.staleCommitAck', 'warn', token)
      return
    }

    this.scheduler.clearTimeout(pending.timeoutHandle)
    this.setViewportPhase('MEASURING')
    this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
    this.correctAnchor(pending.anchor)
    this.pendingTransaction = null
    this.setViewportPhase('IDLE')
    this.pushDiagnostic('transaction.settle', 'info', token)
  }

  scrollToLatest(): void {
    this.emitNeed('needLatestMessages', 'scrollToLatest')
  }

  scrollToMessage(
    target: MessageIdentityAnchor,
  ): void {
    this.emitNeed('needMessagesAround', 'scrollToMessage', target)
  }

  restoreToMessage(
    target: MessageIdentityAnchor,
  ): void {
    this.emitNeed('needMessagesAround', 'restoreToMessage', target)
  }

  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic> {
    return this.snapshot
  }

  subscribeSnapshot(listener: MessageListSnapshotListener): () => void {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  subscribeRuntimeEvent(listener: MessageListRuntimeEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeViewportObservation(listener: ViewportObservationListener): () => void {
    return this.subscribeRuntimeEvent((event) => {
      if (event.type === 'viewportObservationChanged') {
        listener(event)
      }
    })
  }

  getViewportAnchor(): MessageIdentityAnchor | null {
    return this.snapshot.segmentMeta.anchor ?? this.lastAnchor
  }

  getDiagnostics(): import('./events').ViewportDiagnosticRecord[] {
    return this.diagnostics.getRecords()
  }

  getEvidence(): ViewportEvidence {
    const measurement = this.lastMeasurement
    return {
      feedId: this.snapshot.feedId,
      generation: this.snapshot.generation,
      segmentRevision: this.snapshot.segmentRevision,
      projectionRevision: this.snapshot.projectionRevision,
      commitToken: this.pendingTransaction?.token ?? this.snapshot.commitToken,
      modifier: this.snapshot.segmentMeta.modifier.type,
      hasMoreBefore: this.snapshot.segmentMeta.hasMoreBefore,
      hasMoreAfter: this.snapshot.segmentMeta.hasMoreAfter,
      bottomLockState: this.snapshot.bottomLockState,
      pendingIntent: this.snapshot.pendingIntent,
      shortSegmentAlignment: this.snapshot.segmentMeta.shortSegmentAlignment,
      phase: this.snapshot.viewportPhase,
      edgeState: this.snapshot.edgeState,
      ...measurement,
    }
  }

  registerMessageFlowElement(element: HTMLElement | null): void {
    this.registry.setMessageFlow(element)
  }

  registerBeforeTriggerElement(element: HTMLElement | null): void {
    this.registry.setBeforeTrigger(element)
  }

  registerAfterTriggerElement(element: HTMLElement | null): void {
    this.registry.setAfterTrigger(element)
  }

  registerBottomMarkerElement(element: HTMLElement | null): void {
    this.registry.setBottomMarker(element)
  }

  registerRowElement(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    const previous = this.registry.getRow(key)

    if (previous && previous !== element) {
      this.resizeObserver?.unobserve(previous)
    }

    this.registry.setRow(key, element)

    if (element) {
      this.resizeObserver?.observe(element)
    }
  }

  beginDirectScroll(): void {}

  writeDirectScrollTop(scrollTop: number): boolean {
    const container = this.registry.snapshot().scrollContainer

    if (!container) {
      return false
    }

    container.scrollTop = scrollTop
    return true
  }

  endDirectScroll(): void {}

  private correctAnchor(anchor: VisualAnchor | null): void {
    if (!anchor) {
      return
    }

    const row = this.registry.getRow(anchor.key)
    const container = this.registry.snapshot().scrollContainer

    if (!row || !container) {
      this.pushDiagnostic('correction.anchorMissing', 'warn', { key: anchor.key })
      return
    }

    const nextTop = row.getBoundingClientRect().top
    const delta = nextTop - anchor.rectTopBeforeCommit

    if (delta !== 0) {
      container.scrollTop += delta
    }

    this.pushDiagnostic('correction.anchorPreserved', 'info', {
      key: anchor.key,
      delta,
    })
  }

  private scheduleResizeMeasurement(): void {
    if (this.resizeFrame !== null) {
      return
    }

    this.resizeFrame = this.scheduler.requestAnimationFrame(() => {
      this.resizeFrame = null
      this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
      this.pushDiagnostic('measurement.resizeDirty', 'info', {
        rowCount: this.lastMeasurement.visibleRows.length,
      })
    })
  }

  private setViewportPhase(phase: MessageListSnapshot['viewportPhase']): void {
    this.snapshot = {
      ...this.snapshot,
      viewportPhase: phase,
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    for (const listener of this.snapshotListeners) {
      listener()
    }
  }

  private pushDiagnostic(
    name: string,
    severity: import('./events').ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ): void {
    const record = this.diagnostics.push(name, severity, details)
    for (const listener of this.eventListeners) {
      listener({ type: 'viewportDiagnostic', record })
    }
  }

  private emitNeed(
    type: 'needLatestMessages' | 'needMessagesAround',
    reason: string,
    target?: MessageIdentityAnchor,
  ): void {
    const base = {
      feedId: this.snapshot.feedId,
      generation: this.snapshot.generation,
      segmentRevision: this.snapshot.segmentRevision,
      requestToken: `request:${this.snapshot.projectionRevision + 1}`,
      reason,
    }
    const event = type === 'needMessagesAround'
      ? { ...base, type, target: target as MessageIdentityAnchor }
      : { ...base, type }
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }
}

function createInitialSnapshot<TMessage, TOptimistic>(
  feedId: string,
): MessageListSnapshot<TMessage, TOptimistic> {
  const commitToken = {
    feedId,
    generation: 0,
    segmentRevision: 0,
    projectionRevision: 0,
  }
  return {
    ...commitToken,
    commitToken,
    items: [],
    segmentMeta: {
      hasMoreBefore: false,
      hasMoreAfter: false,
      modifier: { type: 'bootstrap' },
      shortSegmentAlignment: 'start',
      underflow: 'unknown',
    },
    edgeState: {
      before: { status: 'idle' },
      after: { status: 'idle' },
    },
    bottomLockState: 'UNLOCKED',
    pendingIntent: null,
    viewportPhase: 'IDLE',
  }
}

function createSnapshotFromSegment<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  options: {
    previous: MessageListSnapshot<TMessage, TOptimistic>
    projectionRevision: number
    viewportPhase: MessageListSnapshot['viewportPhase']
  },
): MessageListSnapshot<TMessage, TOptimistic> {
  const commitToken = {
    feedId: segment.feedId,
    generation: segment.generation,
    segmentRevision: segment.segmentRevision,
    projectionRevision: options.projectionRevision,
  }
  return {
    ...options.previous,
    ...commitToken,
    commitToken,
    items: segment.items,
    segmentMeta: {
      hasMoreBefore: segment.hasMoreBefore,
      hasMoreAfter: segment.hasMoreAfter,
      modifier: segment.modifier,
      anchor: segment.anchor,
      anchorStatus: segment.anchorStatus,
      shortSegmentAlignment: 'start',
      underflow: 'unknown',
    },
    viewportPhase: options.viewportPhase,
  }
}

function isSameToken(
  left: ProjectionCommitToken,
  right: ProjectionCommitToken,
): boolean {
  return left.feedId === right.feedId &&
    left.generation === right.generation &&
    left.segmentRevision === right.segmentRevision &&
    left.projectionRevision === right.projectionRevision
}
