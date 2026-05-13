import type {
  MessageDataItem,
  MessageRuntimeItemKey,
  RuntimeObserverFactory,
  RuntimeScheduler,
  WindowConfig,
} from './types'

export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  minOverscanPx: 0,
  maxOverscanPx: 0,
  minMountedItems: 40,
  maxMountedItems: 200,
  trimMarginPx: 0,
  defaultItemHeight: 72,
}

export const DEFAULT_BOTTOM_LOCK_THRESHOLD_PX = 40
export const DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX = 120

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function getRuntimeItemKey(
  item: MessageDataItem,
): MessageRuntimeItemKey {
  return item.key
}

/**
 * registry / height cache 都用字符串 key 做 Map 索引，避免对象引用不同
 * 导致同一条消息在 runtime 内被误认为两个 item。
 */
export function serializeRuntimeItemKey(key: MessageRuntimeItemKey): string {
  if (key.kind === 'committed') {
    return `committed:${key.messageId}`
  }

  return `optimistic:${key.clientMessageId}`
}

export function areRuntimeItemKeysEqual(
  left: MessageRuntimeItemKey,
  right: MessageRuntimeItemKey,
): boolean {
  return serializeRuntimeItemKey(left) === serializeRuntimeItemKey(right)
}

export function isCommittedKey(
  key: MessageRuntimeItemKey,
): key is Extract<MessageRuntimeItemKey, { kind: 'committed' }> {
  return key.kind === 'committed'
}

export function getItemContentVersion(item: MessageDataItem): number {
  if ('contentVersion' in item && typeof item.contentVersion === 'number') {
    return item.contentVersion
  }

  return item.version
}

export function getItemEstimatedHeight(item: MessageDataItem): number | null {
  return typeof item.estimatedHeight === 'number' ? item.estimatedHeight : null
}

export function getDistanceToBottom(container: HTMLElement): number {
  return Math.max(
    0,
    container.scrollHeight - container.scrollTop - container.clientHeight,
  )
}

export function createDefaultScheduler(): RuntimeScheduler {
  const targetWindow =
    typeof window === 'undefined' ? undefined : window

  return {
    requestAnimationFrame(callback) {
      if (targetWindow?.requestAnimationFrame) {
        return targetWindow.requestAnimationFrame(callback)
      }

      return globalThis.setTimeout(
        () => callback(Date.now()),
        16,
      ) as unknown as number
    },
    cancelAnimationFrame(handle) {
      if (targetWindow?.cancelAnimationFrame) {
        targetWindow.cancelAnimationFrame(handle)
        return
      }

      globalThis.clearTimeout(handle)
    },
    setTimeout(callback, timeoutMs) {
      return globalThis.setTimeout(callback, timeoutMs) as unknown as number
    },
    clearTimeout(handle) {
      globalThis.clearTimeout(handle)
    },
    now() {
      return globalThis.performance?.now() ?? Date.now()
    },
  }
}

export function createDefaultObserverFactory(): RuntimeObserverFactory {
  return {
    createResizeObserver(callback) {
      if (typeof ResizeObserver === 'undefined') {
        return null
      }

      return new ResizeObserver(callback)
    },
    createIntersectionObserver(callback, options) {
      if (typeof IntersectionObserver === 'undefined') {
        return null
      }

      return new IntersectionObserver(callback, options)
    },
  }
}

export function mergeWindowConfig(
  override: Partial<WindowConfig> | undefined,
): WindowConfig {
  return {
    ...DEFAULT_WINDOW_CONFIG,
    ...override,
  }
}

export function getWidthBucket(width: number): number {
  return Math.round(width / 32)
}
