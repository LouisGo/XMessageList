import type {
  AnchorState,
  DirectScrollInput,
  MessageDataSnapshot,
  MessageRuntimeCommand,
  MessageRuntimeItemKey,
  MessageViewportSnapshot,
  PhysicalScrollMetrics,
  ProjectionCommitToken,
  RuntimeNextFeedId,
  RuntimeNextGeneration,
  RuntimeEventListener,
  RuntimeListener,
  RuntimeUnsubscribe,
  ViewportDiagnosticRecord,
} from './types'
import { MessageViewportRuntimeController } from './controller/runtimeController'

export type MessageViewportRuntimeOptions = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
}

export class MessageViewportRuntime<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  readonly #controller: MessageViewportRuntimeController<TMessage, TOptimistic>

  constructor(options: MessageViewportRuntimeOptions) {
    this.#controller =
      new MessageViewportRuntimeController<TMessage, TOptimistic>(options)
  }

  attach(container: HTMLElement): void {
    this.#controller.attach(container)
  }

  detach(): void {
    this.#controller.detach()
  }

  destroy(): void {
    this.#controller.destroy()
  }

  setDataSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): void {
    this.#controller.setDataSnapshot(snapshot)
  }

  dispatch(command: MessageRuntimeCommand): void {
    this.#controller.dispatch(command)
  }

  subscribe(listener: RuntimeListener): RuntimeUnsubscribe {
    return this.#controller.subscribe(listener)
  }

  subscribeEvent(listener: RuntimeEventListener): RuntimeUnsubscribe {
    return this.#controller.subscribeEvent(listener)
  }

  getViewportAnchorState(): AnchorState | null {
    return this.#controller.getViewportAnchorState()
  }

  registerRow(
    key: MessageRuntimeItemKey,
    element: HTMLElement | null,
  ): void {
    this.#controller.registerRow(key, element)
  }

  registerTopSpacer(element: HTMLElement | null): void {
    this.#controller.registerTopSpacer(element)
  }

  registerBottomSpacer(element: HTMLElement | null): void {
    this.#controller.registerBottomSpacer(element)
  }

  registerTopSentinel(element: HTMLElement | null): void {
    this.#controller.registerTopSentinel(element)
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    this.#controller.registerBottomSentinel(element)
  }

  subscribePhysicalScroll(
    listener: RuntimeListener,
  ): RuntimeUnsubscribe {
    return this.#controller.subscribePhysicalScroll(listener)
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.#controller.getSnapshot()
  }

  getPhysicalScrollMetrics(): PhysicalScrollMetrics {
    return this.#controller.getPhysicalScrollMetrics()
  }

  notifyProjectionCommitted(commit: ProjectionCommitToken): void {
    this.#controller.notifyProjectionCommitted(commit)
  }

  beginDirectScroll(input: DirectScrollInput): void {
    this.#controller.beginDirectScroll(input)
  }

  writeDirectScrollTop(
    scrollTop: number,
    input: DirectScrollInput,
  ): boolean {
    return this.#controller.writeDirectScrollTop(scrollTop, input)
  }

  endDirectScroll(input: DirectScrollInput): void {
    this.#controller.endDirectScroll(input)
  }

  getDiagnosticRecords(): ViewportDiagnosticRecord[] {
    return this.#controller.getDiagnosticRecords()
  }
}
