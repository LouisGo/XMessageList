import type { DestinationIntentCoordinator } from './destinationIntentCoordinator'
import type { RuntimeStateAxes } from './runtimeStateAxes'
import type {
  MessageRuntimeCommand,
  RuntimeState,
} from '../types'
import type { RuntimeDiagnosticEmitter } from './runtimeTypes'

type RuntimeCommandRouterDeps<TMessage, TOptimistic> = {
  getState: () => RuntimeState
  stateAxes: RuntimeStateAxes
  destinationIntent: DestinationIntentCoordinator<TMessage, TOptimistic>
  setPendingBootstrap: (
    command: Extract<MessageRuntimeCommand, { type: 'bootstrap' }>,
  ) => void
  tryRunPendingBootstrap: () => boolean
  enqueueResetTransaction: (reason: string) => void
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
        this.deps.destinationIntent.startFollowBottomCommand()
        break
      case 'jump':
        this.deps.destinationIntent.clearPendingFollowBottom()
        this.deps.destinationIntent.clearActiveFollowBottomIntent('jump')
        this.deps.destinationIntent.startJumpCommand(command.target, command.origin)
        break
      case 'restore':
        this.deps.destinationIntent.clearPendingFollowBottom()
        this.deps.destinationIntent.clearActiveFollowBottomIntent('restore')
        this.deps.destinationIntent.startRestoreCommand(command.target)
        break
      case 'reset':
        this.deps.destinationIntent.clearPendingFollowBottom()
        this.deps.destinationIntent.clearActiveFollowBottomIntent('reset')
        this.deps.destinationIntent.clearPendingDestinationRequest()
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
