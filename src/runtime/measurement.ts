import type { MessageRuntimeItemKey } from './identity'
import type { RuntimeDomRegistrySnapshot } from './domRegistry'
import type { DOMRectLike, ViewportEvidence } from './snapshot'

export type VisualAnchor = {
  key: MessageRuntimeItemKey
  offsetWithinMessage: number
  rectTopBeforeCommit: number
}

export type RuntimeMeasurement = Pick<
  ViewportEvidence,
  | 'scrollTop'
  | 'clientHeight'
  | 'scrollHeight'
  | 'visibleRows'
  | 'beforeTrigger'
  | 'afterTrigger'
  | 'bottomMarker'
>

export function captureVisualAnchor(
  registry: RuntimeDomRegistrySnapshot,
): VisualAnchor | null {
  const container = registry.scrollContainer

  if (!container) {
    return null
  }

  const containerTop = container.getBoundingClientRect().top

  for (const [key, row] of registry.rows) {
    const rect = row.getBoundingClientRect()

    if (rect.bottom >= containerTop) {
      return {
        key,
        offsetWithinMessage: Math.max(0, containerTop - rect.top),
        rectTopBeforeCommit: rect.top,
      }
    }
  }

  return null
}

export function measureRuntimeDom(
  registry: RuntimeDomRegistrySnapshot,
): RuntimeMeasurement {
  const container = registry.scrollContainer
  const empty = createEmptyRect()

  return {
    scrollTop: container?.scrollTop ?? 0,
    clientHeight: container?.clientHeight ?? 0,
    scrollHeight: container?.scrollHeight ?? 0,
    visibleRows: Array.from(registry.rows, ([key, row]) => {
      const rect = row.getBoundingClientRect()
      return {
        key,
        stableId: row.dataset.messageStableId,
        serverId: row.dataset.messageServerId,
        rowKind: row.dataset.rowKind ?? 'message',
        top: rect.top,
        bottom: rect.bottom,
      }
    }),
    beforeTrigger: toRectLike(registry.beforeTrigger?.getBoundingClientRect() ?? empty),
    afterTrigger: toRectLike(registry.afterTrigger?.getBoundingClientRect() ?? empty),
    bottomMarker: registry.bottomMarker
      ? toRectLike(registry.bottomMarker.getBoundingClientRect())
      : null,
  }
}

export function createEmptyRect(): DOMRectLike {
  return {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
  }
}

function toRectLike(rect: DOMRectLike): DOMRectLike {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  }
}
