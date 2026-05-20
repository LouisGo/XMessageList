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
import { assertSupportedViewportModifier } from './data/modifiers'
import { createInitialPhysicalScrollMetrics } from './geometry/initialMetrics'
import { isProjectionCommitTokenEqual } from './projection/commitToken'
import { createInitialProjectionSnapshot } from './projection/initialSnapshot'

export type MessageViewportRuntimeOptions = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
}

export class MessageViewportRuntime<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  readonly #snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
  readonly #metrics: PhysicalScrollMetrics

  constructor(options: MessageViewportRuntimeOptions) {
    this.#snapshot = createInitialProjectionSnapshot<TMessage, TOptimistic>(
      options,
    )
    this.#metrics = createInitialPhysicalScrollMetrics(options)
  }

  attach(container: HTMLElement): void {
    void container
  }

  detach(): void {}

  destroy(): void {}

  setDataSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): void {
    assertSupportedViewportModifier(snapshot.change.viewportModifier)
    void snapshot
  }

  dispatch(command: MessageRuntimeCommand): void {
    void command
  }

  subscribe(listener: RuntimeListener): RuntimeUnsubscribe {
    void listener
    return noop
  }

  subscribeEvent(listener: RuntimeEventListener): RuntimeUnsubscribe {
    void listener
    return noop
  }

  getViewportAnchorState(): AnchorState | null {
    return null
  }

  registerRow(
    key: MessageRuntimeItemKey,
    element: HTMLElement | null,
  ): void {
    void key
    void element
  }

  registerTopSpacer(element: HTMLElement | null): void {
    void element
  }

  registerBottomSpacer(element: HTMLElement | null): void {
    void element
  }

  registerTopSentinel(element: HTMLElement | null): void {
    void element
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    void element
  }

  subscribePhysicalScroll(
    listener: RuntimeListener,
  ): RuntimeUnsubscribe {
    void listener
    return noop
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.#snapshot
  }

  getPhysicalScrollMetrics(): PhysicalScrollMetrics {
    return this.#metrics
  }

  notifyProjectionCommitted(commit: ProjectionCommitToken): void {
    // commit ack 必须携带完整 projection token；P2 固定匹配规则但不提升真实 metrics。
    void isProjectionCommitTokenEqual(
      this.#snapshot.commitToken,
      commit,
    )
  }

  beginDirectScroll(input: DirectScrollInput): void {
    void input
  }

  writeDirectScrollTop(
    scrollTop: number,
    input: DirectScrollInput,
  ): boolean {
    void scrollTop
    void input

    return false
  }

  endDirectScroll(input: DirectScrollInput): void {
    void input
  }

  getDiagnosticRecords(): ViewportDiagnosticRecord[] {
    return []
  }
}

function noop(): void {}
