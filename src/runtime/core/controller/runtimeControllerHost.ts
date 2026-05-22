import type { HeightDelta } from '../../dom/measurementEngine'
import type { RuntimeDiagnosticInput } from '../../debug/diagnosticRecorder'
import type { HeightCache } from '../../window/spacerEngine'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'
import type {
  BootstrapCommand,
  CommitRecoveryInput,
  ContainerSize,
  DestinationMotionForcedStart,
} from '../state/runtimeTypes'
import type {
  AnchorState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageViewportRuntimeEvent,
  MessageViewportSnapshot,
  RenderWindow,
  RuntimeEventListener,
  RuntimeState,
  ScrollSource,
  ViewportAnchorChangeReason,
} from '../../types'

export type RuntimeControllerHost<TMessage, TOptimistic> = {
  stateAxes: RuntimeStateAxes
  heightCache: HeightCache
  eventListeners: Set<RuntimeEventListener>
  getState: () => RuntimeState
  setState: (state: RuntimeState) => void
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  setDataSnapshot: (snapshot: MessageDataSnapshot<TMessage, TOptimistic>) => void
  setPendingBootstrap: (command: BootstrapCommand | null) => void
  getCurrentFrame: () => number
  setCurrentFrame: (frame: number) => void
  getRetainedScrollTop: () => number | null
  setRetainedScrollTop: (scrollTop: number | null) => void
  getLastScrollSource: () => ScrollSource | null
  setLastScrollSource: (source: ScrollSource | null) => void
  getLastDiagnosticScrollSource: () => ScrollSource | null
  setLastDiagnosticScrollSource: (source: ScrollSource | null) => void
  getLastUserScrollTop: () => number
  setLastUserScrollTop: (scrollTop: number) => void
  getLastUserDistanceToBottom: () => number
  setLastUserDistanceToBottom: (distance: number) => void
  getLastContainerSize: () => ContainerSize | null
  setLastContainerSize: (size: ContainerSize | null) => void
  getScrollbarDragIntentActive: () => boolean
  setScrollbarDragIntentActive: (active: boolean) => void
  getScrollbarDragEdgeIntent: () => 'before' | 'after' | null
  setScrollbarDragEdgeIntent: (edge: 'before' | 'after' | null) => void
  canEmitEdgeNeeds: () => boolean
  tryRunPendingBootstrap: () => boolean
  enqueuePrependTransaction: () => void
  enqueueAppendTransaction: (effect: 'append' | 'auto-scroll-to-bottom') => void
  enqueueProjectionRefresh: () => void
  enqueueJumpTransaction: (
    target: MessageIdentityAnchor,
    options?: {
      forceAnimateFrom?: DestinationMotionForcedStart
      allowPreposition?: boolean
      animate?: boolean
      originalTarget?: MessageIdentityAnchor
    },
  ) => void
  enqueueRestoreTransaction: (
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ) => void
  enqueueViewportCompactionTransaction: (
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ) => void
  enqueueRemoveFromStartTransaction: () => void
  enqueueItemLocationTransaction: () => void
  enqueueIdentityRebindTransaction: () => void
  enqueueAnchorRiskTransaction: () => void
  enqueueResetTransaction: (reason: string) => void
  enqueueFollowBottomTransaction: () => void
  keepCurrentWindow: (
    items: Array<MessageDataItem<TMessage, TOptimistic>>,
  ) => RenderWindow
  measureCurrentWindow: () => HeightDelta[]
  recoverAfterCommitFailure: (
    input: CommitRecoveryInput<TMessage, TOptimistic>,
  ) => void
  deriveRuntimeStateFromSnapshot: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => RuntimeState
  captureViewportAnchor: () => AnchorState | null
  readContainerSize: (container: HTMLElement) => ContainerSize
  attachDomListeners: (container: HTMLElement) => void
  detachDomListeners: (container: HTMLElement) => void
  cancelScheduledWork: () => void
  emitViewportAnchorChanged: (
    reason: ViewportAnchorChangeReason,
    anchor?: AnchorState | null,
  ) => void
  getDiagnosticContext: () => {
    feedId: string
    generation: number
    state: RuntimeState
    readySubstate: string
    viewportPhase: string
    transactionState: string
    destinationState: string
    pendingCommands: number
  }
  emitEvent: (event: MessageViewportRuntimeEvent) => void
  emitDiagnostic: (input: RuntimeDiagnosticInput) => void
  emitError: (code: string) => void
}
