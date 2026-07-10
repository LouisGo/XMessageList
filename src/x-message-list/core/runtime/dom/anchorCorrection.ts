import {
  resolveAnchorFromKey,
  resolveTransactionAnchorCandidateKeys,
} from '../shared/snapshotIdentity'
import type { RuntimeDomRegistry } from './domRegistry'
import type { RuntimeDomInteractions } from './domInteractions'
import type { MessageListRuntimeEvent } from '../contracts/events'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { VisualAnchor } from './measurement'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'

/**
 * commit 后按旧 visual anchor 计算滚动补偿；锚点缺失时只在可测行内降级，并发出诊断或错误事件。
 */
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

  const anchorCandidateKeys = resolveTransactionAnchorCandidateKeys(anchor.key, segment)
  const key = anchorCandidateKeys.find((candidate) => registry.getRow(candidate)) ??
    anchorCandidateKeys[0] ??
    anchor.key
  const row = registry.getRow(key)
  const container = registry.snapshot().scrollContainer
  const resolvedAnchor = resolveAnchorFromKey(segment, key) ?? segment.anchor ?? null

  if (!row || !container) {
    const fallback = container
      ? findNearestMeasurableRow({
          key,
          rectTopBeforeCommit: anchor.rectTopBeforeCommit,
          registry,
          segment,
        })
      : null

    if (fallback) {
      const delta = fallback.row.getBoundingClientRect().top -
        anchor.rectTopBeforeCommit
      if (delta !== 0) {
        domInteractions.writeProgrammaticScroll(
          container,
          container.scrollTop + delta,
          'recovery',
        )
      }
      pushDiagnostic('correction.anchorFallback', 'warn', {
        missingKey: key,
        fallbackKey: fallback.key,
        delta,
      })
      return resolveAnchorFromKey(segment, fallback.key) ?? resolvedAnchor
    }

    pushDiagnostic('correction.anchorMissing', 'warn', { key })
    emitRuntimeEvent({
      type: 'viewportError',
      sessionId: snapshot.sessionId,
      code: 'anchor-missing',
      message: 'Anchor row was not available after projection commit.',
    })
    return resolvedAnchor
  }

  const delta = row.getBoundingClientRect().top - anchor.rectTopBeforeCommit

  if (delta !== 0) {
    domInteractions.writeProgrammaticScroll(
      container,
      container.scrollTop + delta,
      'recovery',
    )
  }

  pushDiagnostic('correction.anchorPreserved', 'info', { key, delta })
  if (segment.modifier.type === 'remove' && key !== anchor.key) {
    const removed = segment.modifier.removed.find((entry) => entry.key === anchor.key)
    pushDiagnostic('correction.deletedAnchorFallback', 'info', {
      removedKey: anchor.key,
      fallbackKey: key,
      strategy: removed?.successorKey === key ? 'successor' : 'predecessor',
      delta,
    })
  }
  return resolvedAnchor
}

function findNearestMeasurableRow<TMessage, TOptimistic>(input: {
  key: string
  rectTopBeforeCommit: number
  registry: RuntimeDomRegistry
  segment: LoadedSegment<TMessage, TOptimistic>
}): { key: string; row: HTMLElement } | null {
  const registrySnapshot = input.registry.snapshot()
  const targetIndex = input.segment.items.findIndex((item) =>
    item.key === input.key
  )
  const itemIndexByKey = new Map(
    input.segment.items.map((item, index) => [item.key, index]),
  )
  let fallback: { key: string; row: HTMLElement; distance: number } | null = null

  for (const [candidateKey, row] of registrySnapshot.rows) {
    if (!itemIndexByKey.has(candidateKey)) {
      continue
    }

    const candidateIndex = itemIndexByKey.get(candidateKey) as number
    const distance = targetIndex >= 0
      ? Math.abs(candidateIndex - targetIndex)
      : Math.abs(row.getBoundingClientRect().top - input.rectTopBeforeCommit)

    if (!fallback || distance < fallback.distance) {
      fallback = { key: candidateKey, row, distance }
    }
  }

  return fallback
    ? { key: fallback.key, row: fallback.row }
    : null
}
