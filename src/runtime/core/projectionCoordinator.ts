import type { DomRegistry } from '../dom/domRegistry'
import type { ProjectionStore } from './projectionStore'
import type { SpacerEngine } from '../window/spacerEngine'
import type {
  MessageDataItem,
  MessageDataSnapshot,
  MessageViewportSnapshot,
  RenderWindow,
  ViewportEdgeState,
} from '../types'
import {
  areRuntimeItemKeysEqual,
  getRuntimeItemKey,
} from '../shared/utils'
import type {
  PublishProjectionInput,
  PublishResult,
} from './runtimeTypes'

export class ProjectionCoordinator<TMessage, TOptimistic> {
  private projectedItemsCache = new WeakMap<
    Array<MessageDataItem<TMessage, TOptimistic>>,
    Map<string, Array<MessageDataItem<TMessage, TOptimistic>>>
  >()

  constructor(
    private readonly store: ProjectionStore<TMessage, TOptimistic>,
    private readonly registry: DomRegistry,
    private readonly spacer: SpacerEngine,
  ) {}

  publish(
    input: PublishProjectionInput<TMessage, TOptimistic>,
  ): PublishResult<TMessage, TOptimistic> {
    const container = this.registry.getContainer()
    const width = container?.clientWidth ?? 0
    const topSpacer =
      input.topSpacer ??
      this.spacer.computeTopSpacer(
        input.data.items,
        input.renderWindow.startIndex,
        width,
      )
    const bottomSpacer =
      input.bottomSpacer ??
      this.spacer.computeBottomSpacer(
        input.data.items,
        input.renderWindow.endIndex,
        width,
      )
    const current = this.store.getSnapshot()
    const items = this.getProjectedItems(
      input.data.items,
      input.renderWindow.startIndex,
      input.renderWindow.endIndex + 1,
    )
    const bottomLockState = this.getProjectedBottomLockState(
      input.data,
      input.bottomLockState,
    )
    const edgeState = createEdgeState(input.data)
    // revision 只在 React 需要重新 commit 时递增；相同 projection 复用快照，避免空事务等待 ack。
    const nextRevision = this.isProjectionEqual(current, {
      feedId: input.data.feedId,
      generation: input.data.generation,
      items,
      renderWindow: input.renderWindow,
      topSpacer,
      bottomSpacer,
      bottomLockState,
      bootstrapState: input.bootstrapState,
      edgeState,
    })
      ? current.revision
      : current.revision + 1

    const snapshot: MessageViewportSnapshot<TMessage, TOptimistic> = {
      feedId: input.data.feedId,
      generation: input.data.generation,
      revision: nextRevision,
      items,
      renderWindow: input.renderWindow,
      topSpacer: Math.max(0, topSpacer),
      bottomSpacer: Math.max(0, bottomSpacer),
      bottomLockState,
      bootstrapState: input.bootstrapState,
      edgeState,
    }

    if (nextRevision !== current.revision) {
      this.store.setSnapshot(snapshot)
      return { snapshot, changed: true }
    }

    return { snapshot: current, changed: false }
  }

  getProjectedBottomLockState(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    state: MessageViewportSnapshot['bottomLockState'],
  ): MessageViewportSnapshot['bottomLockState'] {
    // Snapshot 不能把 partial DataWindow 的底部暴露成 LOCKED；
    // 否则 React overlay 和接入层会误以为已经回到会话最新消息。
    return data.hasMoreAfter && state === 'LOCKED' ? 'UNLOCKED' : state
  }

  isRenderWindowEqual(left: RenderWindow, right: RenderWindow): boolean {
    if (
      left.startIndex !== right.startIndex ||
      left.endIndex !== right.endIndex ||
      left.itemKeys.length !== right.itemKeys.length
    ) {
      return false
    }

    return left.itemKeys.every((key, index) =>
      areRuntimeItemKeysEqual(key, right.itemKeys[index]),
    )
  }

  private isProjectionEqual(
    current: MessageViewportSnapshot<TMessage, TOptimistic>,
    next: Omit<MessageViewportSnapshot<TMessage, TOptimistic>, 'revision'>,
  ): boolean {
    return (
      current.feedId === next.feedId &&
      current.generation === next.generation &&
      current.bootstrapState === next.bootstrapState &&
      current.bottomLockState === next.bottomLockState &&
      Math.abs(current.topSpacer - next.topSpacer) <= 0.5 &&
      Math.abs(current.bottomSpacer - next.bottomSpacer) <= 0.5 &&
      isEdgeStateEqual(current.edgeState, next.edgeState) &&
      this.isRenderWindowEqual(current.renderWindow, next.renderWindow) &&
      this.areProjectionItemsEqual(current.items, next.items)
    )
  }

  private areProjectionItemsEqual(
    left: Array<MessageDataItem<TMessage, TOptimistic>>,
    right: Array<MessageDataItem<TMessage, TOptimistic>>,
  ): boolean {
    if (left.length !== right.length) {
      return false
    }

    return left.every((item, index) => {
      const next = right[index]

      return (
        Boolean(next) &&
        areRuntimeItemKeysEqual(getRuntimeItemKey(item), getRuntimeItemKey(next)) &&
        // version 是业务内容变更信号；key 相同但 version 变化时必须触发 projection commit。
        item.version === next.version
      )
    })
  }

  private getProjectedItems(
    items: Array<MessageDataItem<TMessage, TOptimistic>>,
    startIndex: number,
    endIndex: number,
  ): Array<MessageDataItem<TMessage, TOptimistic>> {
    const cacheKey = `${startIndex}:${endIndex}`
    let itemCache = this.projectedItemsCache.get(items)

    if (!itemCache) {
      itemCache = new Map()
      this.projectedItemsCache.set(items, itemCache)
    }

    const cached = itemCache.get(cacheKey)

    if (cached) {
      return cached
    }

    const projectedItems = items.slice(startIndex, endIndex)
    itemCache.set(cacheKey, projectedItems)
    return projectedItems
  }
}

export function createEdgeState(
  data: MessageDataSnapshot<unknown, unknown>,
): ViewportEdgeState {
  return {
    before: data.hasMoreBefore ? 'idle' : 'exhausted',
    after: data.hasMoreAfter ? 'idle' : 'exhausted',
  }
}

function isEdgeStateEqual(left: ViewportEdgeState, right: ViewportEdgeState): boolean {
  return left.before === right.before && left.after === right.after
}
