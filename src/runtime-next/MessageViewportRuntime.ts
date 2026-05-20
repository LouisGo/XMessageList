import type {
  MessageViewportSnapshot,
  PhysicalScrollMetrics,
  ProjectionCommitToken,
  RuntimeNextCommand,
  RuntimeNextDataSnapshot,
  RuntimeNextDiagnosticRecord,
  RuntimeNextFeedId,
  RuntimeNextGeneration,
  RuntimeNextListener,
  RuntimeNextUnsubscribe,
} from './types'
import { createInitialPhysicalScrollMetrics } from './geometry/initialMetrics'
import { isProjectionCommitTokenEqual } from './projection/commitToken'
import { createInitialProjectionSnapshot } from './projection/initialSnapshot'

export type MessageViewportRuntimeOptions = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
}

export class MessageViewportRuntime<TPayload = unknown> {
  readonly #snapshot: MessageViewportSnapshot<TPayload>
  readonly #metrics: PhysicalScrollMetrics
  #lastDataSnapshot: RuntimeNextDataSnapshot<TPayload> | null = null
  #lastCommand: RuntimeNextCommand | null = null
  #lastCommitAccepted = false

  constructor(options: MessageViewportRuntimeOptions) {
    this.#snapshot = createInitialProjectionSnapshot<TPayload>(options)
    this.#metrics = createInitialPhysicalScrollMetrics(options)
  }

  attach(container: HTMLElement): void {
    void container
  }

  detach(): void {}

  destroy(): void {}

  setDataSnapshot(snapshot: RuntimeNextDataSnapshot<TPayload>): void {
    this.#lastDataSnapshot = snapshot
  }

  dispatch(command: RuntimeNextCommand): void {
    this.#lastCommand = command
  }

  subscribe(listener: RuntimeNextListener): RuntimeNextUnsubscribe {
    void listener
    return noop
  }

  subscribePhysicalScroll(
    listener: RuntimeNextListener,
  ): RuntimeNextUnsubscribe {
    void listener
    return noop
  }

  getSnapshot(): MessageViewportSnapshot<TPayload> {
    return this.#snapshot
  }

  getPhysicalScrollMetrics(): PhysicalScrollMetrics {
    return this.#metrics
  }

  notifyProjectionCommitted(commit: ProjectionCommitToken): boolean {
    // commit ack 必须精确匹配 projection token；P2 只记录合同结果，不提升真实 metrics。
    this.#lastCommitAccepted = isProjectionCommitTokenEqual(
      this.#snapshot.commitToken,
      commit,
    )
    return this.#lastCommitAccepted
  }

  getDiagnosticRecords(): readonly RuntimeNextDiagnosticRecord[] {
    return []
  }

  getContractDebugSnapshot(): {
    readonly lastDataSnapshot: RuntimeNextDataSnapshot<TPayload> | null
    readonly lastCommand: RuntimeNextCommand | null
    readonly lastCommitAccepted: boolean
  } {
    return {
      lastDataSnapshot: this.#lastDataSnapshot,
      lastCommand: this.#lastCommand,
      lastCommitAccepted: this.#lastCommitAccepted,
    }
  }
}

function noop(): void {}
