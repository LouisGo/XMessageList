import { MessageViewportRuntimeController } from './core/MessageViewportRuntimeController'
import type {
  AnchorState,
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
} from './types'

/**
 * Public viewport runtime facade.
 *
 * The implementation lives in `core/MessageViewportRuntimeController` so this
 * file stays focused on the stable consumer-facing runtime surface.
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

  subscribe(listener: RuntimeListener): () => void {
    return this.controller.subscribe(listener)
  }

  subscribeEvent(listener: RuntimeEventListener): () => void {
    return this.controller.subscribeEvent(listener)
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.controller.getSnapshot()
  }

  getViewportAnchorState(): AnchorState | null {
    return this.controller.getViewportAnchorState()
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
      | 'READY_MOTION_ACTIVE'
    pendingCommands: number
    motionActive: boolean
    observedRows: number
    heightCacheSize: number
    lastScrollSource: ScrollSource | null
  } {
    return this.controller.getDebugSnapshot()
  }
}
