import { DomRegistry } from './domRegistry'
import { LifecycleGuard } from './lifecycleGuard'
import { MeasurementEngine, type HeightDelta } from './measurementEngine'
import { ProjectionStore, createEmptySnapshot } from './projectionStore'
import { RenderWindowEngine } from './renderWindowEngine'
import { ScrollIntentEngine } from './scrollIntentEngine'
import { SpacerEngine, type HeightCache } from './spacerEngine'
import { TransactionRunner } from './transactionRunner'
import type {
  AnchorState,
  BootstrapState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageRuntimeCommand,
  MessageRuntimeItemKey,
  MessageViewportRuntimeEvent,
  MessageViewportRuntimeOptions,
  MessageViewportSnapshot,
  ProjectionCommit,
  RenderWindow,
  RuntimeEventListener,
  RuntimeListener,
  RuntimeObserverFactory,
  RuntimeScheduler,
  RuntimeState,
  ScrollSource,
  ViewportEdgeState,
  ViewportTransactionKind,
  WindowConfig,
} from './types'
import {
  DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
  DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
  areRuntimeItemKeysEqual,
  createDefaultObserverFactory,
  createDefaultScheduler,
  getDistanceToBottom,
  getRuntimeItemKey,
  mergeWindowConfig,
} from './utils'

type PendingCommit = {
  feedId: string
  generation: number
  revision: number
  transactionKind: ViewportTransactionKind
  timeoutId: number
  resolve: () => void
  reject: (error: Error) => void
}

type PublishResult<TMessage, TOptimistic> = {
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
  changed: boolean
}

const BOOTSTRAP_STABLE_FRAMES = 2
const BOOTSTRAP_HEIGHT_EPSILON_PX = 1
const BOOTSTRAP_SETTLE_TIMEOUT_MS = 300

/**
 * MessageViewportRuntime 是独立于 React 的 IM viewport engine。
 * 它拥有滚动语义、DOM 测量、anchor 稳定和 transaction；React 只能订阅 projection。
 */
export class MessageViewportRuntime<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  private readonly config: WindowConfig

  private readonly scheduler: RuntimeScheduler

  private readonly observerFactory: RuntimeObserverFactory

  private readonly heightCache: HeightCache = new Map()

  private readonly store: ProjectionStore<TMessage, TOptimistic>

  private readonly registry = new DomRegistry()

  private readonly lifecycle: LifecycleGuard

  private readonly spacer: SpacerEngine

  private readonly renderWindow: RenderWindowEngine

  private readonly measurement: MeasurementEngine

  private readonly scrollIntent: ScrollIntentEngine

  private readonly transactions = new TransactionRunner()

  private readonly eventListeners = new Set<RuntimeEventListener>()

  private readonly commitTimeoutMs: Required<
    NonNullable<MessageViewportRuntimeOptions['commitTimeoutMs']>
  >

  private state: RuntimeState = 'INITIAL'

  private dataSnapshot: MessageDataSnapshot<TMessage, TOptimistic> | null = null

  private pendingBootstrap: Extract<MessageRuntimeCommand, { type: 'bootstrap' }> | null =
    null

  private pendingCommit: PendingCommit | null = null

  private scrollRaf: number | null = null

  private stabilizationRaf: number | null = null

  private resizeRaf: number | null = null

  private currentFrame = 0

  private containerResizeObserver: ResizeObserver | null = null

  private intersectionObserver: IntersectionObserver | null = null

  private readonly handleScroll = (): void => {
    this.scheduleScrollRaf()
  }

  constructor(options: MessageViewportRuntimeOptions = {}) {
    const feedId = options.feedId ?? ''
    const generation = options.generation ?? 0
    const defaultObservers = createDefaultObserverFactory()

    this.config = mergeWindowConfig(options.window)
    this.scheduler = options.scheduler ?? createDefaultScheduler()
    this.observerFactory = {
      createResizeObserver:
        options.observers?.createResizeObserver ??
        defaultObservers.createResizeObserver,
      createIntersectionObserver:
        options.observers?.createIntersectionObserver ??
        defaultObservers.createIntersectionObserver,
    }
    this.commitTimeoutMs = {
      bootstrap: options.commitTimeoutMs?.bootstrap ?? 1000,
      normal: options.commitTimeoutMs?.normal ?? 500,
      jump: options.commitTimeoutMs?.jump ?? 800,
    }

    this.store = new ProjectionStore(
      createEmptySnapshot<TMessage, TOptimistic>(feedId, generation),
    )
    this.lifecycle = new LifecycleGuard(feedId, generation)
    this.spacer = new SpacerEngine(this.config, this.heightCache)
    this.renderWindow = new RenderWindowEngine(this.config, this.spacer)
    this.measurement = new MeasurementEngine(
      this.heightCache,
      this.observerFactory,
      () => this.scheduleHeightStabilization(),
    )
    this.scrollIntent = new ScrollIntentEngine(
      options.bottomLockThresholdPx ?? DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
      options.bottomUnlockThresholdPx ?? DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
    )
  }

  attach(container: HTMLElement): void {
    if (this.state === 'DESTROYED') {
      return
    }

    const current = this.registry.getContainer()

    if (current === container) {
      return
    }

    if (current) {
      this.detach()
    }

    this.lifecycle.resume()
    this.transactions.resume()
    this.registry.attachContainer(container)
    container.addEventListener('scroll', this.handleScroll, { passive: true })
    this.setupContainerObserver(container)
    this.setupIntersectionObserver(container)
    this.state =
      this.store.getSnapshot().bootstrapState === 'READY' ? 'READY' : 'ATTACHED'
    this.tryRunPendingBootstrap()
  }

  detach(): void {
    if (this.state === 'DESTROYED') {
      return
    }

    const container = this.registry.getContainer()

    this.lifecycle.suspend()
    this.cancelPendingCommit()
    this.cancelScheduledWork()
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver = null
    this.intersectionObserver?.disconnect()
    this.intersectionObserver = null
    this.measurement.disconnect()
    this.transactions.clear()

    if (container) {
      container.removeEventListener('scroll', this.handleScroll)
    }

    this.registry.clearDomRefs()
    this.state = 'DETACHED'
  }

  destroy(): void {
    if (this.state === 'DESTROYED') {
      return
    }

    this.detach()
    this.lifecycle.destroy()
    this.transactions.stop()
    this.heightCache.clear()
    this.eventListeners.clear()
    this.store.clearListeners()
    this.state = 'DESTROYED'
  }

  setDataSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): void {
    if (this.state === 'DESTROYED') {
      return
    }

    const previous = this.dataSnapshot
    const generationChanged =
      previous?.feedId !== snapshot.feedId ||
      previous?.generation !== snapshot.generation

    if (generationChanged) {
      this.resetForGeneration(snapshot.feedId, snapshot.generation)
    }

    this.dataSnapshot = snapshot

    if (this.tryRunPendingBootstrap()) {
      return
    }

    if (this.state === 'INITIAL' || this.state === 'ATTACHED') {
      return
    }

    switch (snapshot.change.viewportEffect) {
      case 'prepend':
        this.enqueuePrependTransaction()
        break
      case 'append':
      case 'auto-scroll-to-bottom':
        this.enqueueAppendTransaction(snapshot.change.viewportEffect)
        break
      case 'reset':
        this.dispatch({ type: 'reset', reason: 'data-reset' })
        break
      default:
        this.enqueueProjectionRefresh()
        break
    }
  }

  dispatch(command: MessageRuntimeCommand): void {
    if (this.state === 'DESTROYED') {
      return
    }

    switch (command.type) {
      case 'bootstrap':
        this.pendingBootstrap = command
        this.tryRunPendingBootstrap()
        break
      case 'followBottom':
        this.followBottom()
        break
      case 'jump':
        this.enqueueJumpTransaction(command.target.messageId)
        break
      case 'restore':
        this.enqueueProjectionRefresh()
        break
      case 'reset':
        this.enqueueResetTransaction(command.reason)
        break
    }
  }

  subscribe(listener: RuntimeListener): () => void {
    return this.store.subscribe(listener)
  }

  subscribeEvent(listener: RuntimeEventListener): () => void {
    this.eventListeners.add(listener)

    return () => {
      this.eventListeners.delete(listener)
    }
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.store.getSnapshot()
  }

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    const previous = this.registry.registerRow(key, element)

    if (previous && previous !== element) {
      this.measurement.unobserveRow(previous)
    }

    this.measurement.observeRow(key, element)
  }

  registerTopSpacer(element: HTMLElement | null): void {
    this.registry.registerTopSpacer(element)
  }

  registerBottomSpacer(element: HTMLElement | null): void {
    this.registry.registerBottomSpacer(element)
  }

  registerTopSentinel(element: HTMLElement | null): void {
    this.registry.registerTopSentinel(element)
    this.observeSentinels()
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    this.registry.registerBottomSentinel(element)
    this.observeSentinels()
  }

  notifyProjectionCommitted(commit: ProjectionCommit): void {
    const pending = this.pendingCommit

    if (
      !pending ||
      pending.feedId !== commit.feedId ||
      pending.generation !== commit.generation ||
      pending.revision !== commit.revision
    ) {
      return
    }

    this.scheduler.clearTimeout(pending.timeoutId)
    this.pendingCommit = null
    pending.resolve()
  }

  getDebugSnapshot(): {
    state: RuntimeState
    pendingCommands: number
    observedRows: number
    heightCacheSize: number
  } {
    return {
      state: this.state,
      pendingCommands: this.transactions.getPendingCount(),
      observedRows: this.registry.getSnapshot().observedRows,
      heightCacheSize: this.heightCache.size,
    }
  }

  private tryRunPendingBootstrap(): boolean {
    if (!this.pendingBootstrap || !this.dataSnapshot || !this.registry.getContainer()) {
      return false
    }

    const command = this.pendingBootstrap
    this.pendingBootstrap = null
    this.transactions.enqueue(
      'bootstrap',
      () => this.runBootstrapTransaction(command.mode),
      'bootstrap',
    )
    return true
  }

  private resetForGeneration(feedId: string, generation: number): void {
    this.lifecycle.reset(feedId, generation)
    this.transactions.clear()
    this.cancelPendingCommit()
    this.cancelScheduledWork()
    this.heightCache.clear()
    this.scrollIntent.setBottomLockState('UNLOCKED')
    this.store.setSnapshot(createEmptySnapshot<TMessage, TOptimistic>(feedId, generation))
    this.state = this.registry.getContainer() ? 'ATTACHED' : 'INITIAL'
  }

  private async runBootstrapTransaction(
    mode: 'latest' | 'unread' | 'restored',
  ): Promise<void> {
    if (!this.dataSnapshot || !this.registry.getContainer()) {
      return
    }

    if (mode !== 'latest') {
      this.emitError(`bootstrap-${mode}-not-implemented`)
      return
    }

    const data = this.dataSnapshot
    this.state = 'BOOTSTRAPPING'

    if (data.items.length === 0) {
      this.publishProjection({
        data,
        renderWindow: this.renderWindow.computeLatestWindow(data.items),
        topSpacer: 0,
        bottomSpacer: 0,
        bootstrapState: 'READY_EMPTY',
        bottomLockState: 'LOCKED',
      })
      this.state = 'READY'
      this.emitEvent({ type: 'viewportReady', feedId: data.feedId, generation: data.generation })
      return
    }

    const renderWindow = this.renderWindow.computeLatestWindow(data.items)
    const projection = this.publishProjection({
      data,
      renderWindow,
      bootstrapState: 'MOUNTING',
      bottomLockState: 'UNLOCKED',
    })

    await this.waitForCommitIfChanged(projection, 'bootstrap')
    this.measureCurrentWindow()
    this.scrollToBottom('followBottom')
    await this.waitForBootstrapSettle(data.feedId, data.generation)
    this.measureCurrentWindow()
    this.scrollIntent.setBottomLockState('LOCKED')
    this.state = 'READY'
    this.publishProjection({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'LOCKED',
    })
    this.emitEvent({ type: 'viewportReady', feedId: data.feedId, generation: data.generation })
  }

  private enqueuePrependTransaction(): void {
    this.transactions.enqueue('prepend', () => this.runPrependTransaction(), 'prepend')
  }

  private async runPrependTransaction(): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const anchor = this.captureViewportAnchor()

    if (!anchor) {
      this.emitError('prepend-anchor-missing')
      return
    }

    const anchorElementBefore = this.registry.getRow(anchor.key)
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top

    if (typeof anchorTopBefore !== 'number') {
      this.emitError('prepend-anchor-dom-missing')
      return
    }

    const anchorIndex = this.renderWindow.findIndexByKey(data.items, anchor.key)
    const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : 0
    const renderWindow = this.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex: safeAnchorIndex,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })

    this.state = 'TRANSACTING'
    this.scrollIntent.setBottomLockState('RECOVERING')
    const projection = this.publishProjection({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'RECOVERING',
    })

    await this.waitForCommitIfChanged(projection, 'prepend')

    const anchorElementAfter = this.registry.getRow(anchor.key)
    const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

    if (typeof anchorTopAfter !== 'number') {
      this.emitError('prepend-anchor-after-missing')
      this.state = 'READY'
      return
    }

    const delta = anchorTopAfter - anchorTopBefore

    if (Math.abs(delta) > 0.5) {
      this.writeScrollTop(container.scrollTop + delta, 'recovery')
    }

    this.measureCurrentWindow()
    this.scrollIntent.setBottomLockState('UNLOCKED')
    this.state = 'READY'
    this.publishProjection({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'UNLOCKED',
    })
  }

  private enqueueAppendTransaction(effect: 'append' | 'auto-scroll-to-bottom'): void {
    this.transactions.enqueue('append', () => this.runAppendTransaction(effect), 'append')
  }

  private async runAppendTransaction(
    effect: 'append' | 'auto-scroll-to-bottom',
  ): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const shouldFollow =
      effect === 'auto-scroll-to-bottom' ||
      this.scrollIntent.getBottomLockState() === 'LOCKED'
    const renderWindow = shouldFollow
      ? this.renderWindow.computeLatestWindow(data.items)
      : this.keepCurrentWindow(data.items)

    this.state = 'TRANSACTING'
    const projection = this.publishProjection({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: this.scrollIntent.getBottomLockState(),
    })

    await this.waitForCommitIfChanged(projection, 'append')
    this.measureCurrentWindow()

    if (shouldFollow) {
      await this.nextFrame(data.feedId, data.generation)
      this.scrollToBottom('followBottom')
      this.scrollIntent.setBottomLockState('LOCKED')
      this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'LOCKED',
      })
    }

    this.state = 'READY'
  }

  private enqueueProjectionRefresh(): void {
    this.transactions.enqueue('resize', async () => {
      const data = this.dataSnapshot

      if (!data) {
        return
      }

      const snapshot = this.store.getSnapshot()
      const renderWindow =
        snapshot.renderWindow.endIndex >= snapshot.renderWindow.startIndex
          ? this.keepCurrentWindow(data.items)
          : this.renderWindow.computeLatestWindow(data.items)

      this.publishProjection({
        data,
        renderWindow,
        bootstrapState: snapshot.bootstrapState,
        bottomLockState: snapshot.bottomLockState,
      })
    })
  }

  private enqueueJumpTransaction(messageId: string): void {
    this.transactions.enqueue(
      'jump',
      () => this.runJumpTransaction(messageId),
      'jump',
    )
  }

  private async runJumpTransaction(messageId: string): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const targetIndex = data.items.findIndex(
      (item) =>
        item.key.kind === 'committed' && item.key.messageId === messageId,
    )

    if (targetIndex < 0) {
      this.emitError('jump-target-missing')
      return
    }

    const renderWindow = this.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex: targetIndex,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })
    const projection = this.publishProjection({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'RECOVERING',
    })

    await this.waitForCommitIfChanged(projection, 'jump')
    const target = this.registry.getRow({ kind: 'committed', messageId })

    if (!target) {
      this.emitError('jump-target-dom-missing')
      return
    }

    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const centerDelta =
      targetRect.top -
      containerRect.top -
      Math.max(0, (container.clientHeight - targetRect.height) / 2)

    this.writeScrollTop(container.scrollTop + centerDelta, 'programmatic')
    this.scrollIntent.setBottomLockState('UNLOCKED')
    this.state = 'READY'
    this.publishProjection({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'UNLOCKED',
    })
  }

  private enqueueResetTransaction(reason: string): void {
    this.transactions.enqueue(
      'reset',
      async () => {
        this.pendingBootstrap = { type: 'bootstrap', mode: 'latest' }
        this.tryRunPendingBootstrap()
        if (!this.dataSnapshot) {
          this.emitError(`reset-${reason}`)
        }
      },
      'reset',
    )
  }

  private followBottom(): void {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container || this.state !== 'READY') {
      return
    }

    this.scrollToBottom('followBottom')
    this.scrollIntent.setBottomLockState('LOCKED')
    this.publishProjection({
      data,
      renderWindow: this.renderWindow.computeLatestWindow(data.items),
      bootstrapState: 'READY',
      bottomLockState: 'LOCKED',
    })
  }

  private publishProjection(input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    renderWindow: RenderWindow
    bootstrapState: BootstrapState
    bottomLockState: MessageViewportSnapshot['bottomLockState']
    topSpacer?: number
    bottomSpacer?: number
  }): PublishResult<TMessage, TOptimistic> {
    const container = this.registry.getContainer()
    const width = container?.clientWidth ?? 0
    const topSpacer =
      input.topSpacer ??
      this.spacer.computeTopSpacer(input.data.items, input.renderWindow.startIndex, width)
    const bottomSpacer =
      input.bottomSpacer ??
      this.spacer.computeBottomSpacer(input.data.items, input.renderWindow.endIndex, width)
    const current = this.store.getSnapshot()
    const items = input.data.items.slice(
      input.renderWindow.startIndex,
      input.renderWindow.endIndex + 1,
    )
    const nextRevision = this.isProjectionEqual(current, {
      feedId: input.data.feedId,
      generation: input.data.generation,
      items,
      renderWindow: input.renderWindow,
      topSpacer,
      bottomSpacer,
      bottomLockState: input.bottomLockState,
      bootstrapState: input.bootstrapState,
      edgeState: this.createEdgeState(input.data),
    })
      ? current.revision
      : current.revision + 1

    const snapshot: MessageViewportSnapshot<TMessage, TOptimistic> = {
      feedId: input.data.feedId,
      generation: input.data.generation,
      revision: nextRevision,
      items,
      renderWindow: input.renderWindow,
      topSpacer: Math.max(0, topSpacer),
      bottomSpacer: Math.max(0, bottomSpacer),
      bottomLockState: input.bottomLockState,
      bootstrapState: input.bootstrapState,
      edgeState: this.createEdgeState(input.data),
    }

    if (nextRevision !== current.revision) {
      this.store.setSnapshot(snapshot)
      return { snapshot, changed: true }
    }

    return { snapshot: current, changed: false }
  }

  private async waitForCommitIfChanged(
    result: PublishResult<TMessage, TOptimistic>,
    transactionKind: ViewportTransactionKind,
  ): Promise<void> {
    if (!result.changed) {
      return
    }

    await this.waitForCommit(result.snapshot, transactionKind)
  }

  private waitForCommit(
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
    transactionKind: ViewportTransactionKind,
  ): Promise<void> {
    this.cancelPendingCommit()

    return new Promise((resolve, reject) => {
      const timeoutMs =
        transactionKind === 'bootstrap'
          ? this.commitTimeoutMs.bootstrap
          : transactionKind === 'jump'
            ? this.commitTimeoutMs.jump
            : this.commitTimeoutMs.normal
      const timeoutId = this.scheduler.setTimeout(() => {
        this.pendingCommit = null
        this.emitError(`commit-timeout-${transactionKind}`)
        reject(new Error(`Projection commit timed out: ${transactionKind}`))
      }, timeoutMs)

      this.pendingCommit = {
        feedId: snapshot.feedId,
        generation: snapshot.generation,
        revision: snapshot.revision,
        transactionKind,
        timeoutId,
        resolve,
        reject,
      }
    })
  }

  private cancelPendingCommit(): void {
    if (!this.pendingCommit) {
      return
    }

    this.scheduler.clearTimeout(this.pendingCommit.timeoutId)
    this.pendingCommit.reject(new Error('Projection commit cancelled'))
    this.pendingCommit = null
  }

  private measureCurrentWindow(): HeightDelta[] {
    const snapshot = this.store.getSnapshot()
    const container = this.registry.getContainer()

    if (!container) {
      return []
    }

    return this.measurement.measureMountedRows(
      snapshot.items,
      snapshot.revision,
      container.clientWidth,
    )
  }

  private keepCurrentWindow(items: MessageDataItem<TMessage, TOptimistic>[]): RenderWindow {
    const currentWindow = this.store.getSnapshot().renderWindow
    return this.renderWindow.computeWindowFromRange(
      items,
      currentWindow.startIndex,
      currentWindow.endIndex,
    )
  }

  private captureViewportAnchor(): AnchorState | null {
    const container = this.registry.getContainer()
    const snapshot = this.store.getSnapshot()

    if (!container) {
      return null
    }

    const containerTop = container.getBoundingClientRect().top

    for (const item of snapshot.items) {
      const key = getRuntimeItemKey(item)
      const element = this.registry.getRow(key)

      if (!element) {
        continue
      }

      const rect = element.getBoundingClientRect()

      if (rect.bottom >= containerTop) {
        return {
          key,
          offsetWithinMessage: Math.max(0, containerTop - rect.top),
        }
      }
    }

    return null
  }

  private scheduleScrollRaf(): void {
    if (this.scrollRaf !== null) {
      return
    }

    const token = this.lifecycle.getCurrent()
    this.scrollRaf = this.scheduler.requestAnimationFrame(() => {
      this.scrollRaf = null
      this.currentFrame += 1

      if (!this.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.handleScrollFrame()
    })
  }

  private handleScrollFrame(): void {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const distance = getDistanceToBottom(container)
    const changed = this.scrollIntent.updateBottomLockFromDistance(
      distance,
      this.currentFrame,
    )

    if (changed) {
      this.publishProjection({
        data,
        renderWindow: this.keepCurrentWindow(data.items),
        bootstrapState: this.store.getSnapshot().bootstrapState,
        bottomLockState: this.scrollIntent.getBottomLockState(),
      })
    }

    this.emitEdgeNeeds(container, data)
  }

  private scheduleHeightStabilization(): void {
    if (this.stabilizationRaf !== null) {
      return
    }

    const token = this.lifecycle.getCurrent()
    this.stabilizationRaf = this.scheduler.requestAnimationFrame(() => {
      this.stabilizationRaf = null
      this.currentFrame += 1

      if (!this.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.stabilizeDirtyHeights()
    })
  }

  private stabilizeDirtyHeights(): void {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const deltas = this.measurement.flushPendingHeightDeltas(
      this.store.getSnapshot().revision,
      container.clientWidth,
    )

    if (deltas.length === 0) {
      return
    }

    if (this.scrollIntent.getBottomLockState() === 'LOCKED') {
      this.scrollToBottom('followBottom')
      return
    }

    const anchor = this.captureViewportAnchor()

    if (!anchor) {
      return
    }

    const anchorIndex = this.renderWindow.findIndexByKey(data.items, anchor.key)
    const deltaAboveAnchor = deltas.reduce((total, delta) => {
      const deltaIndex = this.renderWindow.findIndexByKey(data.items, delta.key)
      return deltaIndex >= 0 && deltaIndex < anchorIndex ? total + delta.delta : total
    }, 0)

    if (Math.abs(deltaAboveAnchor) > 0.5) {
      this.writeScrollTop(container.scrollTop + deltaAboveAnchor, 'recovery')
    }
  }

  private setupContainerObserver(container: HTMLElement): void {
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver = this.observerFactory.createResizeObserver(() => {
      this.scheduleResizeRaf()
    })
    this.containerResizeObserver?.observe(container)
  }

  private scheduleResizeRaf(): void {
    if (this.resizeRaf !== null) {
      return
    }

    const token = this.lifecycle.getCurrent()
    this.resizeRaf = this.scheduler.requestAnimationFrame(() => {
      this.resizeRaf = null
      this.currentFrame += 1

      if (!this.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      const container = this.registry.getContainer()
      const data = this.dataSnapshot

      if (!container || !data || !this.measurement.invalidateForWidth(container.clientWidth)) {
        return
      }

      this.publishProjection({
        data,
        renderWindow: this.keepCurrentWindow(data.items),
        bootstrapState: this.store.getSnapshot().bootstrapState,
        bottomLockState: this.scrollIntent.getBottomLockState(),
      })
    })
  }

  private setupIntersectionObserver(container: HTMLElement): void {
    this.intersectionObserver?.disconnect()
    this.intersectionObserver = this.observerFactory.createIntersectionObserver(
      (entries) => this.handleIntersectionEntries(entries),
      {
        root: container,
        rootMargin: `${Math.max(0, container.clientHeight * 2)}px 0px`,
        threshold: 0,
      },
    )
    this.observeSentinels()
  }

  private observeSentinels(): void {
    if (!this.intersectionObserver) {
      return
    }

    const top = this.registry.getTopSentinel()
    const bottom = this.registry.getBottomSentinel()

    if (top) {
      this.intersectionObserver.observe(top)
    }

    if (bottom) {
      this.intersectionObserver.observe(bottom)
    }
  }

  private handleIntersectionEntries(entries: IntersectionObserverEntry[]): void {
    const data = this.dataSnapshot

    if (!data) {
      return
    }

    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue
      }

      if (entry.target === this.registry.getTopSentinel() && data.hasMoreBefore) {
        this.emitEvent({
          type: 'needMoreBefore',
          feedId: data.feedId,
          generation: data.generation,
          reason: 'near-top',
        })
      }

      if (entry.target === this.registry.getBottomSentinel() && data.hasMoreAfter) {
        this.emitEvent({
          type: 'needMoreAfter',
          feedId: data.feedId,
          generation: data.generation,
          reason: 'near-bottom',
        })
      }
    }
  }

  private emitEdgeNeeds(
    container: HTMLElement,
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    const snapshot = this.store.getSnapshot()
    const nearTop = container.scrollTop < snapshot.topSpacer + this.getMinOverscanPx(container)
    const nearBottom =
      getDistanceToBottom(container) <
      snapshot.bottomSpacer + this.getMinOverscanPx(container)

    if (nearTop && data.hasMoreBefore) {
      this.emitEvent({
        type: 'needMoreBefore',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'near-top',
      })
    }

    if (nearBottom && data.hasMoreAfter) {
      this.emitEvent({
        type: 'needMoreAfter',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'near-bottom',
      })
    }
  }

  private getMinOverscanPx(container: HTMLElement): number {
    return this.config.minOverscanPx > 0
      ? this.config.minOverscanPx
      : container.clientHeight * 2
  }

  private scrollToBottom(source: Extract<ScrollSource, 'followBottom'>): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    this.writeScrollTop(
      Math.max(0, container.scrollHeight - container.clientHeight),
      source,
    )
  }

  private writeScrollTop(nextScrollTop: number, source: ScrollSource): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    this.scrollIntent.markScrollWrite(source, this.currentFrame)
    container.scrollTop = Math.max(0, nextScrollTop)
  }

  private async waitForBootstrapSettle(
    feedId: string,
    generation: number,
  ): Promise<void> {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    const startedAt = this.scheduler.now()
    let stableFrames = 0
    let previousScrollHeight = container.scrollHeight

    while (
      stableFrames < BOOTSTRAP_STABLE_FRAMES &&
      this.scheduler.now() - startedAt < BOOTSTRAP_SETTLE_TIMEOUT_MS
    ) {
      await this.nextFrame(feedId, generation)

      const nextScrollHeight = container.scrollHeight
      const changed =
        Math.abs(nextScrollHeight - previousScrollHeight) >
        BOOTSTRAP_HEIGHT_EPSILON_PX

      stableFrames = changed ? 0 : stableFrames + 1
      previousScrollHeight = nextScrollHeight

      if (this.scrollIntent.getBottomLockState() === 'LOCKED') {
        this.scrollToBottom('followBottom')
      }
    }
  }

  private nextFrame(feedId: string, generation: number): Promise<void> {
    return new Promise((resolve) => {
      this.scheduler.requestAnimationFrame(() => {
        this.currentFrame += 1

        if (this.lifecycle.isCurrent(feedId, generation)) {
          resolve()
          return
        }

        resolve()
      })
    })
  }

  private cancelScheduledWork(): void {
    if (this.scrollRaf !== null) {
      this.scheduler.cancelAnimationFrame(this.scrollRaf)
      this.scrollRaf = null
    }

    if (this.stabilizationRaf !== null) {
      this.scheduler.cancelAnimationFrame(this.stabilizationRaf)
      this.stabilizationRaf = null
    }

    if (this.resizeRaf !== null) {
      this.scheduler.cancelAnimationFrame(this.resizeRaf)
      this.resizeRaf = null
    }
  }

  private createEdgeState(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): ViewportEdgeState {
    return {
      before: data.hasMoreBefore ? 'idle' : 'exhausted',
      after: data.hasMoreAfter ? 'idle' : 'exhausted',
    }
  }

  private isProjectionEqual(
    current: MessageViewportSnapshot<TMessage, TOptimistic>,
    next: Omit<MessageViewportSnapshot<TMessage, TOptimistic>, 'revision'>,
  ): boolean {
    return (
      current.feedId === next.feedId &&
      current.generation === next.generation &&
      current.bootstrapState === next.bootstrapState &&
      current.bottomLockState === next.bottomLockState &&
      Math.abs(current.topSpacer - next.topSpacer) <= 0.5 &&
      Math.abs(current.bottomSpacer - next.bottomSpacer) <= 0.5 &&
      this.isEdgeStateEqual(current.edgeState, next.edgeState) &&
      this.isRenderWindowEqual(current.renderWindow, next.renderWindow) &&
      this.areProjectionItemsEqual(current.items, next.items)
    )
  }

  private isRenderWindowEqual(left: RenderWindow, right: RenderWindow): boolean {
    if (
      left.startIndex !== right.startIndex ||
      left.endIndex !== right.endIndex ||
      left.itemKeys.length !== right.itemKeys.length
    ) {
      return false
    }

    return left.itemKeys.every((key, index) =>
      areRuntimeItemKeysEqual(key, right.itemKeys[index]),
    )
  }

  private areProjectionItemsEqual(
    left: Array<MessageDataItem<TMessage, TOptimistic>>,
    right: Array<MessageDataItem<TMessage, TOptimistic>>,
  ): boolean {
    if (left.length !== right.length) {
      return false
    }

    return left.every((item, index) => {
      const next = right[index]

      return (
        Boolean(next) &&
        areRuntimeItemKeysEqual(getRuntimeItemKey(item), getRuntimeItemKey(next)) &&
        item.version === next.version
      )
    })
  }

  private isEdgeStateEqual(left: ViewportEdgeState, right: ViewportEdgeState): boolean {
    return left.before === right.before && left.after === right.after
  }

  private emitEvent(event: MessageViewportRuntimeEvent): void {
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }

  private emitError(code: string): void {
    const token = this.lifecycle.getCurrent()
    this.emitEvent({
      type: 'viewportError',
      feedId: token.feedId,
      generation: token.generation,
      code,
    })
  }
}
