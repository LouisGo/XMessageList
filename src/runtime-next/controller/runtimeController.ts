import type { MessageRuntimeCommand } from '../commands/types'
import { classifyDataArrival } from '../data/classifier'
import type { DataArrivalIntent, PendingDataIntent } from '../data/classifier.types'
import { assertSupportedViewportModifier } from '../data/modifiers'
import type { MessageDataSnapshot } from '../data/types'
import { RuntimeDataStore } from '../data/store'
import { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeNextDiagnosticRecord } from '../diagnostics/types'
import { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeEventListener } from '../events/types'
import { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import { PhysicalSegmentRevisionController } from '../geometry/segment/segmentRevision'
import type { PhysicalScrollMetrics } from '../geometry/types'
import type {
  AnchorState,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
  RuntimeListener,
  RuntimeNextTransactionId,
  RuntimeUnsubscribe,
} from '../identity/types'
import { ProjectionStore } from '../projection/store'
import type {
  BottomLockState,
  MessageViewportSnapshot,
  ProjectionCommitToken,
} from '../projection/types'
import { ScrollWriterArbitration } from '../scroll/writerArbitration'
import type { DirectScrollInput } from '../scroll/types'
import { TransactionRunner } from '../transactions/transactionRunner'
import type {
  RuntimeTransactionIntent,
  TransactionAbortReason,
  TransactionStageRecord,
} from '../transactions/types'
import {
  createNeedLatestEvent,
  createNeedMessagesAroundEvent,
  isTargetAvailable,
} from './controllerHelpers'
import { RuntimeTransactionFlow } from './transactionFlow'
import {
  beginDirectScrollTransaction,
  endDirectScrollTransaction,
  writeDirectScrollTopWithWriter,
} from './runtimeControllerDirectScroll'
import {
  emitNeedForPendingIntent,
  recordDataIntent,
  recordTransactionStage,
  shouldRetainPendingDataIntent,
} from './runtimeControllerSupport'

const ACK_TIMEOUT_MS = 250

export type RuntimeViewportControllerOptions = {
  readonly feedId: string
  readonly generation: number
  readonly now?: () => number
  readonly ackTimeoutMs?: number
}

export class MessageViewportRuntimeController<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  readonly #feedId: string
  readonly #generation: number
  readonly #ackTimeoutMs: number
  readonly #data: RuntimeDataStore<TMessage, TOptimistic>
  readonly #dom = new RuntimeDomRegistry()
  readonly #writer = new ScrollWriterArbitration()
  readonly #projection: ProjectionStore<TMessage, TOptimistic>
  readonly #metrics: PhysicalMetricsStore
  readonly #revision: PhysicalSegmentRevisionController
  readonly #diagnostics: DiagnosticRecorder
  readonly #runner: TransactionRunner<TMessage, TOptimistic>
  readonly #flow: RuntimeTransactionFlow<TMessage, TOptimistic>
  readonly #listeners = new Set<RuntimeListener>()
  readonly #physicalListeners = new Set<RuntimeListener>()
  readonly #eventListeners = new Set<RuntimeEventListener>()

  #pendingBootstrap: RuntimeTransactionIntent<TMessage, TOptimistic> | null = null
  #pendingDataIntent: PendingDataIntent | null = null
  #ackTimer: ReturnType<typeof setTimeout> | null = null
  #destroyed = false
  #bottomLockState: BottomLockState = 'UNLOCKED'
  #currentScrollTop = 0

  constructor(options: RuntimeViewportControllerOptions) {
    this.#feedId = options.feedId
    this.#generation = options.generation
    this.#ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS
    this.#data = new RuntimeDataStore({
      feedId: options.feedId,
      generation: options.generation,
    })
    this.#projection = new ProjectionStore({
      feedId: options.feedId,
      generation: options.generation,
      onChange: () => this.#emitProjectionChange(),
    })
    this.#metrics = new PhysicalMetricsStore({
      feedId: options.feedId,
      generation: options.generation,
      onChange: () => this.#emitPhysicalChange(),
    })
    this.#revision = new PhysicalSegmentRevisionController({
      feedId: options.feedId,
      generation: options.generation,
      now: options.now,
    })
    this.#diagnostics = new DiagnosticRecorder({
      now: options.now,
      onRecord: (record) => this.#emitEvent({
        type: 'viewportDiagnostic',
        ...record,
      }),
    })
    this.#runner = new TransactionRunner({
      now: options.now,
      onStage: (record) => this.#recordTransactionStage(record),
    })
    this.#flow = new RuntimeTransactionFlow({
      data: this.#data,
      dom: this.#dom,
      projection: this.#projection,
      metrics: this.#metrics,
      revision: this.#revision,
      writer: this.#writer,
      runner: this.#runner,
      diagnostics: this.#diagnostics,
      getBottomLockState: () => this.#bottomLockState,
      setBottomLockState: (state) => {
        this.#bottomLockState = state
      },
      getCurrentScrollTop: () => this.#currentScrollTop,
      setCurrentScrollTop: (scrollTop) => {
        this.#currentScrollTop = scrollTop
      },
      armAckTimeout: (transactionId) => this.#armAckTimeout(transactionId),
      clearAckTimeout: () => this.#clearAckTimeout(),
      enqueue: (intent) => this.#enqueue(intent),
      finish: (transactionId) => this.#finish(transactionId),
      abort: (reason) => this.#abortActive(reason),
      recoverRelayoutBounds: (target) => this.#recoverRelayoutBounds(target),
    })
  }

  attach(container: HTMLElement): void {
    if (this.#destroyed) return
    this.#dom.attach(container)
    this.#emitEvent({
      type: 'viewportReady',
      feedId: this.#feedId,
      generation: this.#generation,
    })
  }

  detach(): void {
    this.#cancelActive('detach')
    this.#dom.detach()
    this.#bottomLockState = 'UNLOCKED'
  }

  destroy(): void {
    this.detach()
    this.#destroyed = true
    this.#runner.clearQueue()
  }

  setDataSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): void {
    if (this.#destroyed) return
    if (!this.#data.isCurrentSnapshot(snapshot)) {
      this.#diagnostics.record({
        kind: 'data-generation-mismatch',
        severity: 'error',
        owner: 'data',
        message: 'ignored data snapshot for another feed or generation',
        details: {
          expectedFeedId: this.#feedId,
          expectedGeneration: this.#generation,
          receivedFeedId: snapshot.feedId,
          receivedGeneration: snapshot.generation,
        },
      })
      this.#emitEvent({
        type: 'viewportError',
        feedId: this.#feedId,
        generation: this.#generation,
        code: 'data-generation-mismatch',
      })
      return
    }
    assertSupportedViewportModifier(snapshot.change.viewportModifier)
    this.#data.setSnapshot(snapshot)

    if (this.#pendingBootstrap !== null) {
      const intent = this.#pendingBootstrap
      this.#pendingBootstrap = null
      this.#enqueue(intent)
      return
    }

    const active = this.#activeDataProjection()
    const { intent } = classifyDataArrival({
      snapshot,
      activeProjection: active,
      pendingIntent: this.#pendingDataIntent,
    })
    this.#pendingDataIntent = shouldRetainPendingDataIntent(
      this.#pendingDataIntent,
      intent,
    )
      ? this.#pendingDataIntent
      : null
    if (this.#pendingDataIntent !== null && intent.kind === 'no-op') {
      this.#emitNeedForPendingIntent(this.#pendingDataIntent)
    }
    recordDataIntent(this.#diagnostics, intent)
    this.#enqueueDataIntent(intent)
  }

  dispatch(command: MessageRuntimeCommand): void {
    if (this.#destroyed) return
    if (command.type === 'bootstrap') {
      const intent: RuntimeTransactionIntent<TMessage, TOptimistic> = {
        kind: 'bootstrap',
        mode: command.mode,
        target: command.target,
        temporaryUnreadFallback:
          command.mode === 'unread' && command.target === undefined,
      }
      if (this.#data.getSnapshot() === null) {
        this.#pendingBootstrap = intent
        this.#emitEvent(createNeedLatestEvent(this.#ids()))
      } else {
        this.#enqueue(intent)
      }
      return
    }
    if (command.type === 'followBottom') {
      this.#dispatchFollowBottom()
      return
    }
    if (command.type === 'jump') {
      this.#dispatchDestination('jump', command.target)
      return
    }
    if (command.type === 'restore') {
      this.#dispatchDestination('restore', command.target)
      return
    }
    this.#enqueue({ kind: 'reset', reason: command.reason })
  }

  subscribe(listener: RuntimeListener): RuntimeUnsubscribe {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  subscribeEvent(listener: RuntimeEventListener): RuntimeUnsubscribe {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  subscribePhysicalScroll(listener: RuntimeListener): RuntimeUnsubscribe {
    this.#physicalListeners.add(listener)
    return () => this.#physicalListeners.delete(listener)
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.#projection.getSnapshot()
  }

  getPhysicalScrollMetrics(): PhysicalScrollMetrics {
    return this.#metrics.getMetrics()
  }

  getViewportAnchorState(): AnchorState | null {
    const key = this.#projection.getSnapshot().renderWindow.itemKeys[0]
    return key === undefined ? null : { key, offsetWithinMessage: 0 }
  }

  getDiagnosticRecords(): RuntimeNextDiagnosticRecord[] {
    return this.#diagnostics.getRecords()
  }

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    this.#dom.registerRow(key, element)
  }

  registerTopSpacer(element: HTMLElement | null): void {
    this.#dom.registerTopSpacer(element)
  }

  registerBottomSpacer(element: HTMLElement | null): void {
    this.#dom.registerBottomSpacer(element)
  }

  registerTopSentinel(element: HTMLElement | null): void {
    this.#dom.registerTopSentinel(element)
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    this.#dom.registerBottomSentinel(element)
  }

  notifyProjectionCommitted(commit: ProjectionCommitToken): void {
    this.#flow.handleProjectionCommitted(commit)
  }

  beginDirectScroll(input: DirectScrollInput): void {
    beginDirectScrollTransaction(input, this.#directScrollContext())
  }

  writeDirectScrollTop(scrollTop: number, input: DirectScrollInput): boolean {
    const wrote = writeDirectScrollTopWithWriter(
      scrollTop,
      input,
      this.#directScrollContext(),
    )
    if (wrote) this.#metrics.patchScrollPosition(this.#currentScrollTop)
    return wrote
  }

  endDirectScroll(input: DirectScrollInput): void {
    endDirectScrollTransaction(input, this.#directScrollContext())
  }

  enqueueInternalTransaction(
    intent: RuntimeTransactionIntent<TMessage, TOptimistic>,
  ): void {
    this.#enqueue(intent)
  }

  #dispatchFollowBottom(): void {
    const snapshot = this.#data.getSnapshot()
    if (snapshot === null || snapshot.hasMoreAfter) {
      this.#pendingDataIntent = { kind: 'followBottom' }
      this.#emitEvent(createNeedLatestEvent(this.#ids()))
      return
    }
    this.#enqueue({ kind: 'followBottom' })
  }

  #dispatchDestination(
    kind: 'jump' | 'restore',
    target: MessageIdentityAnchor | AnchorState,
  ): void {
    const snapshot = this.#data.getSnapshot()
    if (snapshot === null || !isTargetAvailable(snapshot.items, target)) {
      this.#pendingDataIntent = { kind, target } as PendingDataIntent
      this.#emitEvent(createNeedMessagesAroundEvent({
        ...this.#ids(),
        reason: kind,
        target,
      }))
      return
    }
    this.#enqueue({ kind, target } as RuntimeTransactionIntent<TMessage, TOptimistic>)
  }

  #enqueueDataIntent(intent: DataArrivalIntent): void {
    if (intent.kind === 'no-op') return
    if (intent.kind === 'projectionRefresh') this.#enqueue({ kind: 'projectionRefresh' })
    if (intent.kind === 'segmentRelayout') this.#enqueue({ kind: 'segmentRelayout', reason: intent.reason })
    if (intent.kind === 'segmentShift') this.#enqueue({ kind: 'segmentShift', direction: intent.direction })
    if (intent.kind === 'followBottom') this.#enqueue({ kind: 'followBottom' })
    if (intent.kind === 'jump') this.#enqueue({ kind: 'jump', target: intent.target })
    if (intent.kind === 'restore') this.#enqueue({ kind: 'restore', target: intent.target })
    if (intent.kind === 'reset') this.#enqueue({ kind: 'reset', reason: intent.reason })
  }

  #recoverRelayoutBounds(target: AnchorState): void {
    this.#pendingDataIntent = {
      kind: 'restore',
      target,
    }
    this.#emitNeedForPendingIntent(this.#pendingDataIntent)
  }

  #enqueue(intent: RuntimeTransactionIntent<TMessage, TOptimistic>): void {
    this.#runner.enqueue(intent)
    this.#drain()
  }

  #drain(): void {
    while (this.#runner.getActive() === null && this.#runner.getQueueLength() > 0) {
      const transaction = this.#runner.startNext()
      if (transaction === null) return
      this.#flow.begin(transaction)
      if (this.#runner.getActive() !== null) return
    }
  }

  #finish(transactionId: RuntimeNextTransactionId): void {
    this.#flow.clearPending()
    this.#clearAckTimeout()
    this.#writer.releaseTransaction(transactionId)
    this.#runner.completeActive(transactionId)
    this.#drain()
  }

  #abortActive(reason: TransactionAbortReason): void {
    const active = this.#runner.getActive()
    if (active !== null) {
      this.#revision.abortPendingPublication()
      this.#writer.releaseTransaction(active.id)
    }
    this.#flow.clearPending()
    this.#clearAckTimeout()
    this.#runner.abortActive(reason)
    this.#drain()
  }

  #cancelActive(reason: TransactionAbortReason): void {
    this.#abortActive(reason)
    this.#runner.clearQueue()
    this.#writer.forceRelease()
  }

  #armAckTimeout(transactionId: RuntimeNextTransactionId): void {
    this.#clearAckTimeout()
    this.#ackTimer = setTimeout(() => {
      if (this.#runner.getActive()?.id === transactionId) this.#abortActive('timeout')
    }, this.#ackTimeoutMs)
  }

  #clearAckTimeout(): void {
    if (this.#ackTimer !== null) {
      clearTimeout(this.#ackTimer)
      this.#ackTimer = null
    }
  }

  #recordTransactionStage(
    record: TransactionStageRecord<TMessage, TOptimistic>,
  ): void {
    recordTransactionStage(this.#diagnostics, record)
  }

  #emitNeedForPendingIntent(intent: PendingDataIntent): void {
    emitNeedForPendingIntent(
      this.#feedId,
      this.#generation,
      (event) => this.#emitEvent(event),
      intent,
    )
  }

  #activeDataProjection() {
    const segment = this.#revision.getCommittedSegment()
    if (segment === null) return null
    return {
      renderWindow: this.#projection.getSnapshot().renderWindow,
      logicalStartItemKey: segment.logicalStartItemKey,
      logicalEndItemKey: segment.logicalEndItemKey,
    }
  }

  #ids(): { readonly feedId: string; readonly generation: number } {
    return { feedId: this.#feedId, generation: this.#generation }
  }

  #directScrollContext() {
    return {
      writer: this.#writer,
      metrics: this.#metrics,
      dom: this.#dom,
      diagnostics: this.#diagnostics,
      setCurrentScrollTop: (scrollTop: number) => {
        this.#currentScrollTop = scrollTop
      },
    }
  }

  #emitEvent(event: Parameters<RuntimeEventListener>[0]): void {
    for (const listener of this.#eventListeners) listener(event)
  }

  #emitProjectionChange(): void {
    for (const listener of this.#listeners) listener()
  }

  #emitPhysicalChange(): void {
    for (const listener of this.#physicalListeners) listener()
    for (const listener of this.#listeners) listener()
  }
}
