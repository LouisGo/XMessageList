import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { MessageListSnapshot } from '../contracts/snapshot'

export type RuntimeDirtyReason =
  | 'resize'
  | 'render-version'
  | 'width'
  | 'segment'
  | 'unknown'

export type RuntimeDirtyRange = {
  keys: Set<MessageRuntimeItemKey>
  firstIndex: number | null
  lastIndex: number | null
  reason: RuntimeDirtyReason
  fallbackFullMeasure: boolean
  missingKeys: MessageRuntimeItemKey[]
}

export class RuntimeDirtyRangeRegistry {
  private readonly keys = new Map<MessageRuntimeItemKey, RuntimeDirtyReason>()
  private allDirtyReason: RuntimeDirtyReason | null = null

  clear(): void {
    this.keys.clear()
    this.allDirtyReason = null
  }

  markDirty(key: MessageRuntimeItemKey, reason: RuntimeDirtyReason): void {
    this.keys.set(key, reason)
  }

  markDirtyKeys(
    keys: Iterable<MessageRuntimeItemKey>,
    reason: RuntimeDirtyReason,
  ): void {
    for (const key of keys) {
      this.markDirty(key, reason)
    }
  }

  markAllDirty(reason: RuntimeDirtyReason): void {
    this.allDirtyReason = reason
  }

  deleteKey(key: MessageRuntimeItemKey): void {
    this.keys.delete(key)
  }

  isEmpty(): boolean {
    return this.keys.size === 0 && this.allDirtyReason === null
  }

  resolve<TMessage, TOptimistic>(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): RuntimeDirtyRange {
    if (this.allDirtyReason) {
      return {
        keys: new Set(snapshot.items.map((item) => item.key)),
        firstIndex: snapshot.items.length > 0 ? 0 : null,
        lastIndex: snapshot.items.length > 0 ? snapshot.items.length - 1 : null,
        reason: this.allDirtyReason,
        fallbackFullMeasure: true,
        missingKeys: [],
      }
    }

    const indexByKey = new Map<MessageRuntimeItemKey, number>()
    snapshot.items.forEach((item, index) => {
      indexByKey.set(item.key, index)
    })

    const keys = new Set<MessageRuntimeItemKey>()
    const missingKeys: MessageRuntimeItemKey[] = []
    let firstIndex: number | null = null
    let lastIndex: number | null = null
    let reason: RuntimeDirtyReason = 'resize'

    for (const [key, keyReason] of this.keys) {
      const index = indexByKey.get(key)

      if (index === undefined) {
        missingKeys.push(key)
        continue
      }

      keys.add(key)
      reason = mergeReason(reason, keyReason)
      firstIndex = firstIndex === null ? index : Math.min(firstIndex, index)
      lastIndex = lastIndex === null ? index : Math.max(lastIndex, index)
    }

    return {
      keys,
      firstIndex,
      lastIndex,
      reason: missingKeys.length > 0 ? 'unknown' : reason,
      fallbackFullMeasure: missingKeys.length > 0,
      missingKeys,
    }
  }
}

function mergeReason(
  current: RuntimeDirtyReason,
  next: RuntimeDirtyReason,
): RuntimeDirtyReason {
  if (current === next) {
    return current
  }
  if (current === 'unknown' || next === 'unknown') {
    return 'unknown'
  }
  if (current === 'width' || next === 'width') {
    return 'width'
  }
  if (current === 'segment' || next === 'segment') {
    return 'segment'
  }
  if (current === 'render-version' || next === 'render-version') {
    return 'render-version'
  }
  return 'resize'
}
