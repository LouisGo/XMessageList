import type { MessageRuntimeCommand } from '../commands/types'
import { classifyDataArrival } from '../data/classifier'
import type { PendingDataIntent } from '../data/classifier.types'
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
import { createNeedLatestEvent } from './controllerHelpers'
import { RuntimeTransactionFlow } from './transactionFlow'
import { RuntimeControllerInputCoordinator } from './runtimeControllerInput'
import {
  dispatchDestination,
  dispatchFollowBottom,
  enqueueDataIntent,
} from './runtimeControllerCommands'
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
  readonly #inputCoordinator: RuntimeControllerInputCoordinator<
    TMessage,
    TOptimistic
  >
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
    this.#inputCoordinator = new RuntimeControllerInputCoordinator({
      feedId: this.#feedId,
      generation: this.#generation,
      data: this.#data,
      dom: this.#dom,
      metrics: this.#metrics,
      revision: this.#revision,
      writer: this.#writer,
      diagnostics: this.#diagnostics,
      projection: this.#projection,
      getDestroyed: () => this.#destroyed,
      setBottomLockState: (state) => {
        this.#bottomLockState = state
      },
      setCurrentScrollTop: (scrollTop) => {
        this.#currentScrollTop = scrollTop
      },
      getCurrentScrollTop: () => this.#currentScrollTop,
      enqueue: (intent) => this.#enqueue(intent),
      setPendingDataIntent: (intent) => {
        this.#pendingDataIntent = intent
      },
      emitNeedForPendingIntent: (intent) =>
        this.#emitNeedForPendingIntent(intent),
      emitEvent: (event) => this.#emitEvent(event),
    })
    this.#flow = new RuntimeTransactionFlow({
      data: this.#data,
      dom: this.#dom,
      projection: this.#projection,
      metrics: this.#metrics,
      revision: this.#revision,
      writer: this.#writer,
      motion: this.#inputCoordinator.motion(),
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
      resolveScrollFlagsForPromotion: (transaction) =>
        this.#inputCoordinator.resolveScrollFlagsForPromotion(transaction),
      armAckTimeout: (transactionId) => this.#armAckTimeout(transactionId),
      clearAckTimeout: () => this.#clearAckTimeout(),
      enqueue: (intent) => this.#enqueue(intent),
      finish: (transactionId) => this.#finish(transactionId),
      abort: (reason) => this.#abortActive(reason),
      recoverRelayoutBounds: (target) => this.#recoverRelayoutBounds(target),
      deferPendingDataIntent: (intent) => {
        this.#pendingDataIntent = intent
        this.#emitNeedForPendingIntent(intent)
      },
    })
  }

  attach(container: HTMLElement): void {
    if (this.#destroyed) return
    this.#dom.attach(container)
    this.#inputCoordinator.attach(container)
    this.#emitEvent({
      type: 'viewportReady',
      feedId: this.#feedId,
      generation: this.#generation,
    })
  }

  detach(): void {
    this.#cancelActive('detach')
    this.#emitEvent({
      type: 'viewportAnchorChanged',
      feedId: this.#feedId,
      generation: this.#generation,
      reason: 'detach',
      anchor: this.getViewportAnchorState(),
    })
    this.#inputCoordinator.detach()
    this.#dom.detach()
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
    this.#inputCoordinator.syncAdjacentPrefetchState()

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
    if (
      snapshot.change.viewportModifier === 'auto-scroll-to-bottom' &&
      intent.kind === 'no-op' &&
      intent.reason === 'latest-data-still-missing'
    ) {
      this.#pendingDataIntent = { kind: 'followBottom' }
      this.#emitNeedForPendingIntent(this.#pendingDataIntent)
      recordDataIntent(this.#diagnostics, intent)
      return
    }
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
    enqueueDataIntent(this.#commandContext(), intent)
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
      dispatchFollowBottom(this.#commandContext())
      return
    }
    if (command.type === 'jump') {
      dispatchDestination(this.#commandContext(), 'jump', command.target)
      return
    }
    if (command.type === 'restore') {
      dispatchDestination(this.#commandContext(), 'restore', command.target)
      return
    }
    this.#enqueue({ kind: 'reset', reason: command.reason })
  }

  subscribe(listener: RuntimeListener): RuntimeUnsubscribe {
    this.#listeners.add(listener); return () => this.#listeners.delete(listener)
  }
  subscribeEvent(listener: RuntimeEventListener): RuntimeUnsubscribe {
    this.#eventListeners.add(listener); return () => this.#eventListeners.delete(listener)
  }
  subscribePhysicalScroll(listener: RuntimeListener): RuntimeUnsubscribe {
    this.#physicalListeners.add(listener); return () => this.#physicalListeners.delete(listener)
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.#projection.getSnapshot()
  }

  getPhysicalScrollMetrics(): PhysicalScrollMetrics { return this.#metrics.getMetrics() }
  getViewportAnchorState(): AnchorState | null {
    return this.#dom.resolveViewportAnchor(
      this.#projection.getSnapshot().renderWindow.itemKeys,
    )
  }

  getDiagnosticRecords(): RuntimeNextDiagnosticRecord[] { return this.#diagnostics.getRecords() }

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    this.#dom.registerRow(key, element)
    this.#inputCoordinator.registerRow(key, element)
  }

  registerTopSpacer(element: HTMLElement | null): void { this.#dom.registerTopSpacer(element) }

  registerBottomSpacer(element: HTMLElement | null): void { this.#dom.registerBottomSpacer(element) }

  registerTopSentinel(element: HTMLElement | null): void { this.#dom.registerTopSentinel(element) }

  registerBottomSentinel(element: HTMLElement | null): void { this.#dom.registerBottomSentinel(element) }

  notifyProjectionCommitted(commit: ProjectionCommitToken): void { this.#flow.handleProjectionCommitted(commit) }

  beginDirectScroll(input: DirectScrollInput): void {
    if (this.#destroyed) return
    beginDirectScrollTransaction(input, this.#inputCoordinator.directScrollContext())
  }

  writeDirectScrollTop(scrollTop: number, input: DirectScrollInput): boolean {
    if (this.#destroyed) return false
    const wrote = writeDirectScrollTopWithWriter(
      scrollTop,
      input,
      this.#inputCoordinator.directScrollContext(),
    )
    return wrote
  }

  endDirectScroll(input: DirectScrollInput): void {
    if (this.#destroyed) return
    endDirectScrollTransaction(input, this.#inputCoordinator.directScrollContext())
  }

  enqueueInternalTransaction(
    intent: RuntimeTransactionIntent<TMessage, TOptimistic>,
  ): void {
    this.#enqueue(intent)
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
      this.#flow.abortPending()
      this.#revision.abortPendingPublication()
      this.#writer.releaseTransaction(active.id)
      this.#inputCoordinator.handleTransactionAbort(active)
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
    this.#inputCoordinator.cancelAll()
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

  #commandContext() {
    return {
      getDataSnapshot: () => this.#data.getSnapshot(),
      ids: () => this.#ids(),
      enqueue: (intent: RuntimeTransactionIntent<TMessage, TOptimistic>) =>
        this.#enqueue(intent),
      setPendingDataIntent: (intent: PendingDataIntent) => {
        this.#pendingDataIntent = intent
      },
      emitEvent: (event: Parameters<RuntimeEventListener>[0]) =>
        this.#emitEvent(event),
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
  }
}
