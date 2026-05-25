import { MessageViewportRuntimeController } from './core/controller/MessageViewportRuntimeController'
import type {
  AnchorState,
  DirectScrollInput,
  MessageDataSnapshot,
  MessageRuntimeCommand,
  MessageRuntimeItemKey,
  MessageViewportRuntimeOptions,
  MessageViewportSnapshot,
  ProjectionCommit,
  RuntimeEventListener,
  RuntimeListener,
  RuntimeState,
  ScrollSource,
  ViewportDiagnosticRecord,
  ViewportObservationListener,
} from './types'

/**
 * Public viewport runtime facade.
 *
 * The implementation lives under `core/controller` so this file stays focused
 * on the stable consumer-facing runtime surface.
 */
export class MessageViewportRuntime<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  private readonly controller: MessageViewportRuntimeController<
    TMessage,
    TOptimistic
  >

  constructor(options: MessageViewportRuntimeOptions = {}) {
    this.controller = new MessageViewportRuntimeController(options)
  }

  attach(container: HTMLElement): void {
    this.controller.attach(container)
  }

  detach(): void {
    this.controller.detach()
  }

  destroy(): void {
    this.controller.destroy()
  }

  setDataSnapshot(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    this.controller.setDataSnapshot(snapshot)
  }

  dispatch(command: MessageRuntimeCommand): void {
    this.controller.dispatch(command)
  }

  beginDirectScroll(input: DirectScrollInput): void {
    this.controller.beginDirectScroll(input)
  }

  writeDirectScrollTop(scrollTop: number, input: DirectScrollInput): boolean {
    return this.controller.writeDirectScrollTop(scrollTop, input)
  }

  endDirectScroll(input: DirectScrollInput): void {
    this.controller.endDirectScroll(input)
  }

  subscribe(listener: RuntimeListener): () => void {
    return this.controller.subscribe(listener)
  }

  subscribeEvent(listener: RuntimeEventListener): () => void {
    return this.controller.subscribeEvent(listener)
  }

  subscribeViewportObservation(listener: ViewportObservationListener): () => void {
    return this.controller.subscribeViewportObservation(listener)
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.controller.getSnapshot()
  }

  getViewportAnchorState(): AnchorState | null {
    return this.controller.getViewportAnchorState()
  }

  getDiagnosticRecords(): ViewportDiagnosticRecord[] {
    return this.controller.getDiagnosticRecords()
  }

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    this.controller.registerRow(key, element)
  }

  registerTopSpacer(element: HTMLElement | null): void {
    this.controller.registerTopSpacer(element)
  }

  registerBottomSpacer(element: HTMLElement | null): void {
    this.controller.registerBottomSpacer(element)
  }

  registerTopSentinel(element: HTMLElement | null): void {
    this.controller.registerTopSentinel(element)
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    this.controller.registerBottomSentinel(element)
  }

  notifyProjectionCommitted(commit: ProjectionCommit): void {
    this.controller.notifyProjectionCommitted(commit)
  }

  getDebugSnapshot(): {
    state: RuntimeState
    readySubstate:
      | 'READY_IDLE'
      | 'READY_FOLLOW_BOTTOM_PENDING'
      | 'READY_DESTINATION_PENDING'
      | 'READY_VIEWPORT_COMPACTION_PENDING'
      | 'READY_MOTION_ACTIVE'
    viewportPhase: 'IDLE' | 'PROJECTING' | 'MEASURING' | 'CORRECTING' | 'MOTION_ACTIVE'
    transactionState: 'idle' | 'queued' | 'active' | 'settling'
    destinationState:
      | 'idle'
      | 'pendingData'
      | 'resolvingDom'
      | 'motionActive'
      | 'interrupted'
      | 'settled'
    pendingCommands: number
    motionActive: boolean
    observedRows: number
    heightCacheSize: number
    lastScrollSource: ScrollSource | null
  } {
    return this.controller.getDebugSnapshot()
  }
}
