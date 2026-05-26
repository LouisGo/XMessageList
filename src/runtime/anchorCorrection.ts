import {
  resolveAnchorFromKey,
  resolveRemappedAnchorKey,
} from './controllerHelpers'
import type { RuntimeDomRegistry } from './domRegistry'
import type { RuntimeDomInteractions } from './domInteractions'
import type { MessageListRuntimeEvent } from './events'
import type { MessageIdentityAnchor } from './identity'
import type { VisualAnchor } from './measurement'
import type { LoadedSegment } from './segment'
import type { MessageListSnapshot } from './snapshot'

export function correctTransactionAnchor<TMessage, TOptimistic>(options: {
  anchor: VisualAnchor | null
  segment: LoadedSegment<TMessage, TOptimistic>
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  registry: RuntimeDomRegistry
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  pushDiagnostic: (
    name: string,
    severity: 'debug' | 'info' | 'warn' | 'error',
    details: Record<string, unknown>,
  ) => void
  emitRuntimeEvent: (event: MessageListRuntimeEvent) => void
}): MessageIdentityAnchor | null {
  const {
    anchor,
    segment,
    snapshot,
    registry,
    domInteractions,
    pushDiagnostic,
    emitRuntimeEvent,
  } = options

  if (!anchor) {
    return segment.anchor ?? null
  }

  const key = resolveRemappedAnchorKey(anchor.key, segment)
  const row = registry.getRow(key)
  const container = registry.snapshot().scrollContainer
  const resolvedAnchor = resolveAnchorFromKey(segment, key) ?? segment.anchor ?? null

  if (!row || !container) {
    pushDiagnostic('correction.anchorMissing', 'warn', { key })
    emitRuntimeEvent({
      type: 'viewportError',
      feedId: snapshot.feedId,
      code: 'anchor-missing',
      message: 'Anchor row was not available after projection commit.',
    })
    return resolvedAnchor
  }

  const delta = row.getBoundingClientRect().top - anchor.rectTopBeforeCommit

  if (delta !== 0) {
    domInteractions.writeProgrammaticScroll(container, container.scrollTop + delta)
  }

  pushDiagnostic('correction.anchorPreserved', 'info', { key, delta })
  return resolvedAnchor
}
