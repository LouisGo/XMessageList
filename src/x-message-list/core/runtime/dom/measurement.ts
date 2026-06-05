import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { RuntimeDomRegistrySnapshot } from './domRegistry'
import type { DOMRectLike, ViewportEvidence } from '../contracts/snapshot'

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
> & {
  viewportTop: number
  viewportBottom: number
  rectReadCount: number
  rectReadRows: number
  requestedRowCount: number | null
  fallbackFullMeasure: boolean
}

export type RuntimeMeasurementOptions = {
  rowKeys?: MessageRuntimeItemKey[]
}

/**
 * 捕获 commit 前最靠近 viewport 顶部的可视行，后续 correction 通过它保持视觉锚点稳定。
 */
export function captureVisualAnchor(
  registry: RuntimeDomRegistrySnapshot,
  options: RuntimeMeasurementOptions = {},
): VisualAnchor | null {
  const container = registry.scrollContainer

  if (!container) {
    return null
  }

  const containerTop = container.getBoundingClientRect().top
  const rows = options.rowKeys
    ? options.rowKeys
        .map((key) => [key, registry.rows.get(key)] as const)
        .filter((entry): entry is readonly [MessageRuntimeItemKey, HTMLElement] =>
          Boolean(entry[1]),
        )
    : Array.from(registry.rows)
  const rowRects = rows.map(([key, row]) => ({
    key,
    rect: row.getBoundingClientRect(),
  })).sort((first, second) => first.rect.top - second.rect.top)

  for (const { key, rect } of rowRects) {
    if (rect.bottom > containerTop + 1) {
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
  options: RuntimeMeasurementOptions = {},
): RuntimeMeasurement {
  const container = registry.scrollContainer
  const empty = createEmptyRect()
  let rectReadCount = 0
  const readRect = (element: HTMLElement | null | undefined): DOMRectLike => {
    if (!element) {
      return empty
    }
    rectReadCount += 1
    return element.getBoundingClientRect()
  }
  const viewportRect = readRect(container)
  const rows = options.rowKeys
    ? options.rowKeys
        .map((key) => [key, registry.rows.get(key)] as const)
        .filter((entry): entry is readonly [MessageRuntimeItemKey, HTMLElement] =>
          Boolean(entry[1]),
        )
    : Array.from(registry.rows)

  const measurement: RuntimeMeasurement = {
    scrollTop: container?.scrollTop ?? 0,
    clientHeight: container?.clientHeight ?? 0,
    scrollHeight: container?.scrollHeight ?? 0,
    viewportTop: viewportRect.top,
    viewportBottom: viewportRect.bottom,
    rectReadCount: 0,
    rectReadRows: rows.length,
    requestedRowCount: options.rowKeys?.length ?? null,
    fallbackFullMeasure: !options.rowKeys,
    visibleRows: rows.map(([key, row]) => {
      const rect = readRect(row)
      return {
        key,
        stableId: row.dataset.messageStableId,
        serverId: row.dataset.messageServerId,
        rowKind: row.dataset.rowKind ?? 'message',
        top: rect.top,
        bottom: rect.bottom,
      }
    }),
    beforeTrigger: toRectLike(readRect(registry.beforeTrigger)),
    afterTrigger: toRectLike(readRect(registry.afterTrigger)),
    bottomMarker: registry.bottomMarker
      ? toRectLike(readRect(registry.bottomMarker))
      : null,
  }
  measurement.rectReadCount = rectReadCount
  return measurement
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
