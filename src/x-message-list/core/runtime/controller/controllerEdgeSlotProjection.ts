import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { RuntimeEdge } from '../interactions/interactionState'
import type { RuntimeMeasurement, VisualAnchor } from '../dom/measurement'
import { captureVisualAnchor, measureRuntimeDom } from '../dom/measurement'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import { isSameToken } from './controllerHelpers'

export type PendingEdgeSlotProjection = {
  token: ProjectionCommitToken
  edge: RuntimeEdge
  anchor: VisualAnchor | null
  followBottom: boolean
}

export function prepareEdgeSlotProjection<TMessage, TOptimistic>(input: {
  previous: MessageListSnapshot<TMessage, TOptimistic>
  next: MessageListSnapshot<TMessage, TOptimistic>
  registry: RuntimeDomRegistry
}): PendingEdgeSlotProjection | null {
  const edge = resolveChangedEdge(input.previous, input.next)
  if (!edge) return null
  return {
    token: input.next.commitToken,
    edge,
    anchor: captureVisualAnchor(input.registry.snapshot()),
    followBottom: edge === 'after' && input.previous.bottomLockState === 'LOCKED',
  }
}

export function settleEdgeSlotProjection<TMessage, TOptimistic>(input: {
  pending: PendingEdgeSlotProjection
  registry: RuntimeDomRegistry
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  pushDiagnostic(name: string, severity: 'debug' | 'info' | 'warn', details: Record<string, unknown>): void
}): void {
  if (input.pending.followBottom) {
    const applied = input.domInteractions.scrollToNativeBottom('recovery')
    input.pushDiagnostic('edgeSlot.bottomFollow', 'info', { edge: input.pending.edge, applied })
    return
  }

  const anchor = input.pending.anchor
  const row = anchor ? input.registry.getRow(anchor.key) : null
  const container = input.registry.snapshot().scrollContainer
  if (!anchor || !row || !container) {
    input.pushDiagnostic('edgeSlot.anchorUnavailable', 'debug', { edge: input.pending.edge })
    return
  }

  const delta = row.getBoundingClientRect().top - anchor.rectTopBeforeCommit
  if (delta !== 0) {
    input.domInteractions.writeProgrammaticScroll(
      container,
      container.scrollTop + delta,
      'recovery',
    )
  }
  input.pushDiagnostic('edgeSlot.anchorPreserved', 'info', {
    edge: input.pending.edge,
    key: anchor.key,
    delta,
  })
}

export function commitEdgeSlotProjection<TMessage, TOptimistic>(input: {
  pending: PendingEdgeSlotProjection | null
  token: ProjectionCommitToken
  registry: RuntimeDomRegistry
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  pushDiagnostic(name: string, severity: 'debug' | 'info' | 'warn', details: Record<string, unknown>): void
}): RuntimeMeasurement | null {
  if (!input.pending || !isSameToken(input.pending.token, input.token)) return null
  settleEdgeSlotProjection({
    pending: input.pending,
    registry: input.registry,
    domInteractions: input.domInteractions,
    pushDiagnostic: input.pushDiagnostic,
  })
  return measureRuntimeDom(input.registry.snapshot())
}

function resolveChangedEdge<TMessage, TOptimistic>(
  previous: MessageListSnapshot<TMessage, TOptimistic>,
  next: MessageListSnapshot<TMessage, TOptimistic>,
): RuntimeEdge | null {
  if (previous.edgeState.before.status !== next.edgeState.before.status) return 'before'
  if (previous.edgeState.after.status !== next.edgeState.after.status) return 'after'
  return null
}
