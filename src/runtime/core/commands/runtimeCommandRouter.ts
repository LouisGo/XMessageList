import type { DestinationIntentCoordinator } from './destinationIntentCoordinator'
import type { ViewportCompactionCoordinator } from './viewportCompactionCoordinator'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'
import type {
  MessageRuntimeCommand,
  RuntimeState,
  ViewportEdge,
  ViewportEdgeStatus,
} from '../../types'
import type { RuntimeDiagnosticEmitter } from '../state/runtimeTypes'

type RuntimeCommandRouterDeps<TMessage, TOptimistic> = {
  getState: () => RuntimeState
  stateAxes: RuntimeStateAxes
  destinationIntent: DestinationIntentCoordinator<TMessage, TOptimistic>
  viewportCompaction: ViewportCompactionCoordinator<TMessage, TOptimistic>
  setPendingBootstrap: (
    command: Extract<MessageRuntimeCommand, { type: 'bootstrap' }>,
  ) => void
  tryRunPendingBootstrap: () => boolean
  enqueueResetTransaction: (reason: string) => void
  setEdgeStatus: (edge: ViewportEdge, status: ViewportEdgeStatus) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class RuntimeCommandRouter<TMessage, TOptimistic> {
  constructor(
    private readonly deps: RuntimeCommandRouterDeps<TMessage, TOptimistic>,
  ) {}

  dispatch(command: MessageRuntimeCommand): void {
    if (!this.canAcceptCommand(command)) {
      this.deps.emitDiagnostic({
        channel: 'transaction',
        severity: 'warn',
        name: 'command.rejected',
        correlationId: `command:${command.type}`,
        details: () => ({
          commandType: command.type,
          state: this.deps.getState(),
          readySubstate: this.deps.stateAxes.getReadySubstate(),
        }),
      })
      return
    }

    switch (command.type) {
      case 'bootstrap':
        this.deps.setPendingBootstrap(command)
        this.deps.tryRunPendingBootstrap()
        break
      case 'followBottom':
        this.deps.destinationIntent.clearPendingDestinationRequest()
        this.deps.viewportCompaction.clearPendingViewportCompaction('follow-bottom')
        this.deps.destinationIntent.startFollowBottomCommand()
        break
      case 'setEdgeStatus':
        this.deps.setEdgeStatus(command.edge, command.status)
        break
      case 'jump':
        this.deps.destinationIntent.clearPendingFollowBottom()
        this.deps.destinationIntent.clearActiveFollowBottomIntent('jump')
        this.deps.viewportCompaction.clearPendingViewportCompaction('jump')
        this.deps.destinationIntent.startJumpCommand(command.target, command.origin)
        break
      case 'restore':
        this.deps.destinationIntent.clearPendingFollowBottom()
        this.deps.destinationIntent.clearActiveFollowBottomIntent('restore')
        this.deps.viewportCompaction.clearPendingViewportCompaction('restore')
        this.deps.destinationIntent.startRestoreCommand(command.target)
        break
      case 'reset':
        this.deps.destinationIntent.clearPendingFollowBottom()
        this.deps.destinationIntent.clearActiveFollowBottomIntent('reset')
        this.deps.destinationIntent.clearPendingDestinationRequest()
        this.deps.viewportCompaction.clearPendingViewportCompaction('reset')
        this.deps.enqueueResetTransaction(command.reason)
        break
    }
  }

  private canAcceptCommand(command: MessageRuntimeCommand): boolean {
    const state = this.deps.getState()

    if (state === 'DESTROYED') {
      return false
    }

    if (command.type === 'reset') {
      return true
    }

    if (command.type === 'setEdgeStatus') {
      return true
    }

    if (state === 'INITIAL') {
      return command.type === 'bootstrap'
    }

    if (state === 'ATTACHED' || state === 'DETACHED') {
      return command.type === 'bootstrap'
    }

    if (command.type === 'followBottom') {
      return state === 'READY'
    }

    if (command.type === 'jump' || command.type === 'restore') {
      return state === 'READY'
    }

    return true
  }
}
