import { useLayoutEffect, useRef } from 'react'
import type {
  MessageListSession,
} from '../../core/session-registry/index'
import type {
  MessageListRuntime,
} from '../../core/runtime/index'
import { useLatestCallback } from '../hooks/useLatestCallback'
import type {
  MessageListProps,
  MessageListViewActivationEvent,
} from '../types'

export type RuntimeEventBridgeProps<TMessage, TOptimistic> = Pick<
  MessageListProps<TMessage, TOptimistic>,
  | 'onViewportAnchorChange'
  | 'onViewportObservationChange'
  | 'onViewActivationChange'
> & {
  runtime: MessageListRuntime<TMessage, TOptimistic>
  session: MessageListSession<TMessage>
  presentation: NonNullable<MessageListProps['presentation']>
  activationKey?: string
}

/**
 * 将 runtime 事件订阅转接成 React props 回调；不参与 snapshot 投影，也不持有滚动状态。
 */
export function RuntimeEventBridge<TMessage, TOptimistic>({
  runtime,
  session,
  presentation,
  activationKey,
  onViewportAnchorChange,
  onViewportObservationChange,
  onViewActivationChange,
}: RuntimeEventBridgeProps<TMessage, TOptimistic>) {
  const handleViewportAnchorChange = useLatestCallback(onViewportAnchorChange)
  const handleViewportObservationChange = useLatestCallback(
    onViewportObservationChange,
  )
  const handleViewActivationChange = useLatestCallback(onViewActivationChange)
  const activationStateRef = useRef<{
    activationKey?: string
    terminal: boolean
    viewReady: boolean
  }>({ activationKey, terminal: false, viewReady: false })
  useLayoutEffect(() => {
    if (activationStateRef.current.activationKey === activationKey) return
    activationStateRef.current = {
      activationKey,
      terminal: false,
      viewReady: false,
    }
  }, [activationKey])

  useLayoutEffect(() => {
    const unsubscribers: Array<() => void> = []
    const emitTerminal = (event: MessageListViewActivationEvent) => {
      const state = activationStateRef.current
      if (
        !activationKey ||
        state.activationKey !== activationKey ||
        state.terminal
      ) return
      state.terminal = true
      handleViewActivationChange(event)
    }
    const emitFailed = (
      reason: Extract<MessageListViewActivationEvent, { status: 'failed' }>['reason'],
      error?: unknown,
    ) => {
      if (!activationKey) return
      emitTerminal({
        status: 'failed',
        activationKey,
        sessionId: session.sessionId,
        reason,
        ...(error === undefined ? {} : { error }),
      })
    }
    const tryEmitReady = (resolutionOverride?:
      Extract<MessageListViewActivationEvent, { status: 'ready' }>['resolution']) => {
      if (!activationKey || !activationStateRef.current.viewReady) return
      const sessionState = session.getState()
      if (sessionState.destination.status === 'pending') return
      if (sessionState.destination.status === 'failed') {
        emitFailed(
          sessionState.destination.reason,
          sessionState.destination.error,
        )
        return
      }
      const snapshot = runtime.getSnapshot()
      const resolution = resolutionOverride ?? (
        sessionState.destination.status === 'settled'
          ? sessionState.destination.resolution === 'target'
            ? 'destination-target'
            : 'destination-fallback'
          : snapshot.items.length === 0
            ? 'empty'
            : snapshot.segmentMeta.context === 'history' ||
                snapshot.segmentMeta.context === 'around'
              ? 'initial-restore'
              : 'initial-latest'
      )
      emitTerminal({
        status: 'ready',
        activationKey,
        sessionId: snapshot.sessionId,
        generation: snapshot.generation,
        segmentRevision: snapshot.segmentRevision,
        projectionRevision: snapshot.projectionRevision,
        resolution,
      })
    }

    unsubscribers.push(runtime.subscribeRuntimeEvent((event) => {
      if (event.type === 'viewportAnchorChanged') {
        if (presentation === 'active') handleViewportAnchorChange(event)
        return
      }
      if (event.type === 'projectionSettled') {
        if (event.status === 'commit-timeout') {
          emitFailed('commit-timeout')
          return
        }
        if (event.status === 'applied') {
          activationStateRef.current.viewReady = true
          tryEmitReady()
        }
        return
      }
      if (event.type === 'viewAttachmentSettled') {
        if (event.status === 'anchor-unavailable') {
          emitFailed('anchor-unavailable')
          return
        }
        activationStateRef.current.viewReady = true
        tryEmitReady('warm-restore')
        return
      }
      if (event.type === 'viewportError' && event.code === 'anchor-missing') {
        emitFailed('anchor-unavailable')
      }
    }))

    unsubscribers.push(
      runtime.subscribeViewportObservation((event) => {
        if (presentation === 'active') {
          handleViewportObservationChange(event)
        }
      }),
    )

    unsubscribers.push(session.subscribe(() => {
      const state = session.getState()
      if (state.destination.status === 'failed') {
        emitFailed(state.destination.reason, state.destination.error)
        return
      }
      if (state.overlayStatus.status === 'error') {
        emitFailed('request-failed', state.overlayStatus.error)
        return
      }
      tryEmitReady()
    }))

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [
    handleViewportAnchorChange,
    handleViewportObservationChange,
    handleViewActivationChange,
    activationKey,
    presentation,
    runtime,
    session,
  ])

  return null
}
