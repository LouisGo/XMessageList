import type { DomRegistry } from '../../dom/domRegistry'
import type { ProjectionStore } from '../state/projectionStore'
import type { SpacerEngine } from '../../window/spacerEngine'
import type {
  MessageDataItem,
  MessageDataSnapshot,
  MessageViewportSnapshot,
  RenderWindow,
  ViewportEdge,
  ViewportEdgeState,
  ViewportEdgeStatus,
} from '../../types'
import {
  areRuntimeItemKeysEqual,
  getItemContentVersion,
  getRuntimeItemKey,
} from '../../shared/utils'
import type {
  PublishProjectionInput,
  PublishResult,
  RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'

const MAX_PROJECTED_ITEMS_CACHE_ENTRIES = 48

export class ProjectionCoordinator<TMessage, TOptimistic> {
  private projectedItemsCacheIdentity: string | null = null

  private readonly edgeStatusOverrides: Partial<
    Record<ViewportEdge, ViewportEdgeStatus>
  > = {}

  private readonly projectedItemsCache = new Map<
    string,
    Array<MessageDataItem<TMessage, TOptimistic>>
  >()

  constructor(
    private readonly store: ProjectionStore<TMessage, TOptimistic>,
    private readonly registry: DomRegistry,
    private readonly spacer: SpacerEngine,
    private readonly emitDiagnostic?: RuntimeDiagnosticEmitter,
  ) {}

  publish(
    input: PublishProjectionInput<TMessage, TOptimistic>,
  ): PublishResult<TMessage, TOptimistic> {
    const container = this.registry.getContainer()
    const width = container?.clientWidth ?? 0
    const cacheIdentity = getDataCacheIdentity(input.data)

    this.reconcileEdgeStatusOverrides(input.data)
    this.spacer.setRangeCacheIdentity(cacheIdentity)
    this.setProjectedItemsCacheIdentity(cacheIdentity)

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
    const edgeState = this.createProjectedEdgeState(input.data)
    const viewportPhase = input.viewportPhase ?? current.viewportPhase
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
      viewportPhase,
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
      viewportPhase,
      edgeState,
    }

    if (nextRevision !== current.revision) {
      this.store.setSnapshot(snapshot)
      this.emitProjectionDiagnostic(input, snapshot, true)
      return { snapshot, changed: true }
    }

    this.emitProjectionDiagnostic(input, current, false)
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

  setEdgeStatus(edge: ViewportEdge, status: ViewportEdgeStatus): boolean {
    const previous = this.edgeStatusOverrides[edge] ?? 'idle'

    if (previous === status) {
      return false
    }

    if (status === 'idle') {
      delete this.edgeStatusOverrides[edge]
    } else {
      this.edgeStatusOverrides[edge] = status
    }

    return true
  }

  clearEdgeStatus(edge: ViewportEdge): boolean {
    return this.setEdgeStatus(edge, 'idle')
  }

  clearEdgeStatuses(): boolean {
    const changed = Boolean(
      this.edgeStatusOverrides.before || this.edgeStatusOverrides.after,
    )

    delete this.edgeStatusOverrides.before
    delete this.edgeStatusOverrides.after
    return changed
  }

  hasEdgeStatusOverrides(): boolean {
    return Boolean(
      this.edgeStatusOverrides.before || this.edgeStatusOverrides.after,
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
      current.viewportPhase === next.viewportPhase &&
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
        // version/contentVersion 是业务和布局内容变更信号；key 相同但版本变化时必须触发 commit。
        item.version === next.version &&
        getItemContentVersion(item) === getItemContentVersion(next)
      )
    })
  }

  private getProjectedItems(
    items: Array<MessageDataItem<TMessage, TOptimistic>>,
    startIndex: number,
    endIndex: number,
  ): Array<MessageDataItem<TMessage, TOptimistic>> {
    const cacheKey = `${startIndex}:${endIndex}`
    const cached = this.projectedItemsCache.get(cacheKey)

    if (cached) {
      return cached
    }

    const projectedItems = items.slice(startIndex, endIndex)
    this.setProjectedItemsCache(cacheKey, projectedItems)
    return projectedItems
  }

  private setProjectedItemsCacheIdentity(identity: string): void {
    if (this.projectedItemsCacheIdentity === identity) {
      return
    }

    this.projectedItemsCacheIdentity = identity
    this.projectedItemsCache.clear()
  }

  private setProjectedItemsCache(
    cacheKey: string,
    items: Array<MessageDataItem<TMessage, TOptimistic>>,
  ): void {
    if (this.projectedItemsCache.size >= MAX_PROJECTED_ITEMS_CACHE_ENTRIES) {
      const oldest = this.projectedItemsCache.keys().next().value

      if (typeof oldest === 'string') {
        this.projectedItemsCache.delete(oldest)
      }
    }

    this.projectedItemsCache.set(cacheKey, items)
  }

  private createProjectedEdgeState(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): ViewportEdgeState {
    const base = createEdgeState(data)

    return {
      before:
        base.before === 'exhausted'
          ? base.before
          : this.edgeStatusOverrides.before ?? base.before,
      after:
        base.after === 'exhausted'
          ? base.after
          : this.edgeStatusOverrides.after ?? base.after,
    }
  }

  private reconcileEdgeStatusOverrides(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    if (!data.hasMoreBefore) {
      delete this.edgeStatusOverrides.before
    }

    if (!data.hasMoreAfter) {
      delete this.edgeStatusOverrides.after
    }
  }

  private emitProjectionDiagnostic(
    input: PublishProjectionInput<TMessage, TOptimistic>,
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
    changed: boolean,
  ): void {
    this.emitDiagnostic?.({
      channel: 'projection',
      severity: 'debug',
      name: 'projection.publish',
      correlationId:
        `data:${input.data.feedId}:${input.data.generation}:${input.data.revision}`,
      details: () => ({
        changed,
        dataRevision: input.data.revision,
        snapshotRevision: snapshot.revision,
        bootstrapState: snapshot.bootstrapState,
        bottomLockState: snapshot.bottomLockState,
        viewportPhase: snapshot.viewportPhase,
        renderWindowStart: snapshot.renderWindow.startIndex,
        renderWindowEnd: snapshot.renderWindow.endIndex,
        renderedItems: snapshot.items.length,
        topSpacer: snapshot.topSpacer,
        bottomSpacer: snapshot.bottomSpacer,
        firstKey: snapshot.renderWindow.itemKeys[0] ?? null,
        lastKey:
          snapshot.renderWindow.itemKeys[
            snapshot.renderWindow.itemKeys.length - 1
          ] ?? null,
      }),
    })
  }
}

function getDataCacheIdentity(data: MessageDataSnapshot<unknown, unknown>): string {
  return `${data.feedId}:${data.generation}:${data.revision}`
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
