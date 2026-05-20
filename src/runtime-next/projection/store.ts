import type {
  BottomLockState,
  BootstrapState,
  MessageDataItem,
  MessageViewportSnapshot,
  ProjectionCommitToken,
  RenderWindow,
  ViewportEdgeState,
  ViewportPhase,
} from './types'
import { createInitialProjectionSnapshot } from './initialSnapshot'

export type ProjectionStoreOptions = {
  readonly feedId: string
  readonly generation: number
  readonly onChange?: () => void
}

export type ProjectionPublishInput<TMessage, TOptimistic> = {
  readonly revision: number
  readonly commitToken: ProjectionCommitToken
  readonly items: readonly MessageDataItem<TMessage, TOptimistic>[]
  readonly renderWindow: RenderWindow
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly naturalBlankHeight: number
  readonly bottomLockState?: BottomLockState
  readonly bootstrapState?: BootstrapState
  readonly viewportPhase?: ViewportPhase
  readonly edgeState?: ViewportEdgeState
}

export class ProjectionStore<TMessage = unknown, TOptimistic = unknown> {
  readonly #onChange: () => void
  #snapshot: MessageViewportSnapshot<TMessage, TOptimistic>

  constructor(options: ProjectionStoreOptions) {
    this.#onChange = options.onChange ?? noop
    this.#snapshot = createInitialProjectionSnapshot<TMessage, TOptimistic>(
      options,
    )
  }

  publish(input: ProjectionPublishInput<TMessage, TOptimistic>): void {
    this.#snapshot = {
      ...this.#snapshot,
      revision: input.revision,
      commitToken: input.commitToken,
      items: input.items,
      renderWindow: input.renderWindow,
      topSpacer: input.topSpacer,
      bottomSpacer: input.bottomSpacer,
      naturalBlankHeight: input.naturalBlankHeight,
      bottomLockState:
        input.bottomLockState ?? this.#snapshot.bottomLockState,
      bootstrapState: input.bootstrapState ?? this.#snapshot.bootstrapState,
      viewportPhase: input.viewportPhase ?? this.#snapshot.viewportPhase,
      edgeState: input.edgeState ?? this.#snapshot.edgeState,
    }
    this.#onChange()
  }

  restore(snapshot: MessageViewportSnapshot<TMessage, TOptimistic>): void {
    this.#snapshot = snapshot
    this.#onChange()
  }

  patchState(input: {
    readonly bottomLockState?: BottomLockState
    readonly bootstrapState?: BootstrapState
    readonly viewportPhase?: ViewportPhase
    readonly edgeState?: ViewportEdgeState
  }): void {
    this.#snapshot = {
      ...this.#snapshot,
      bottomLockState:
        input.bottomLockState ?? this.#snapshot.bottomLockState,
      bootstrapState: input.bootstrapState ?? this.#snapshot.bootstrapState,
      viewportPhase: input.viewportPhase ?? this.#snapshot.viewportPhase,
      edgeState: input.edgeState ?? this.#snapshot.edgeState,
    }
    this.#onChange()
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.#snapshot
  }
}

function noop(): void {}
