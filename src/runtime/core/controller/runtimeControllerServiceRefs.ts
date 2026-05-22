import type { TransactionRunner } from '../../transactions/transactionRunner'
import type { ResizeStabilizationCoordinator } from '../viewport/resizeStabilizationCoordinator'
import type { DestinationIntentCoordinator } from '../commands/destinationIntentCoordinator'
import type { RuntimeRecoveryAndMeasurement } from '../recovery/runtimeRecoveryAndMeasurement'
import type { ScrollFrameCoordinator } from '../viewport/scrollFrameCoordinator'
import type { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import type { RuntimeTransactionDiagnostics } from './runtimeTransactionDiagnostics'
import { RuntimeServiceRef } from './runtimeServiceRef'

export function createRuntimeControllerServiceRefs<TMessage, TOptimistic>() {
  return {
    resizeStabilization: new RuntimeServiceRef<ResizeStabilizationCoordinator<
      TMessage,
      TOptimistic
    >>('resizeStabilization'),
    recovery: new RuntimeServiceRef<RuntimeRecoveryAndMeasurement<
      TMessage,
      TOptimistic
    >>('recovery'),
    motion: new RuntimeServiceRef<DestinationMotionCoordinator<
      TMessage,
      TOptimistic
    >>('motion'),
    destinationIntent: new RuntimeServiceRef<DestinationIntentCoordinator<
      TMessage,
      TOptimistic
    >>('destinationIntent'),
    transactions: new RuntimeServiceRef<TransactionRunner>('transactions'),
    transactionDiagnostics: new RuntimeServiceRef<RuntimeTransactionDiagnostics>(
      'transactionDiagnostics',
    ),
    scrollFrame: new RuntimeServiceRef<ScrollFrameCoordinator<
      TMessage,
      TOptimistic
    >>('scrollFrame'),
  }
}
