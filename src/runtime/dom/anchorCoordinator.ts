import type { DomRegistry } from './domRegistry'
import type { ProjectionStore } from '../core/state/projectionStore'
import type { RenderWindowEngine } from '../window/renderWindowEngine'
import type {
  AnchorState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageRuntimeItemKey,
  RenderWindow,
  ScrollSource,
} from '../types'
import {
  areRuntimeItemKeysEqual,
  getRuntimeItemKey,
} from '../shared/utils'
import type { MeasurableRow, RestoreTarget } from '../core/state/runtimeTypes'
import { isAnchorState } from '../core/state/runtimeTypes'

export class AnchorCoordinator<TMessage, TOptimistic> {
  constructor(
    private readonly registry: DomRegistry,
    private readonly store: ProjectionStore<TMessage, TOptimistic>,
    private readonly renderWindow: RenderWindowEngine,
    private readonly nextFrame: (
      feedId: string,
      generation: number,
    ) => Promise<void>,
    private readonly writeScrollTop: (
      nextScrollTop: number,
      source: ScrollSource,
    ) => void,
    private readonly emitError: (code: string) => void,
  ) {}

  resolveRestoreTarget(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): RestoreTarget | null {
    if (!target) {
      return null
    }

    const key =
      isAnchorState(target)
        ? target.key
        : { kind: 'committed' as const, messageId: target.messageId }
    // 外部 identity anchor 没有 DOM offset，只能恢复到消息顶部；内部 AnchorState 才能保留视觉偏移。
    const offsetWithinMessage = isAnchorState(target)
      ? target.offsetWithinMessage
      : 0
    const index = this.renderWindow.findIndexByKey(data.items, key)

    if (index < 0) {
      return null
    }

    return {
      key,
      offsetWithinMessage: Math.max(0, offsetWithinMessage),
      index,
    }
  }

  alignToResolvedRestoreTarget(
    container: HTMLElement,
    target: {
      key: MessageRuntimeItemKey
      offsetWithinMessage: number
    },
    resolved: MeasurableRow,
  ): void {
    const containerTop = container.getBoundingClientRect().top
    const targetRect = resolved.element.getBoundingClientRect()
    const offsetWithinMessage = areRuntimeItemKeysEqual(resolved.key, target.key)
      ? target.offsetWithinMessage
      : 0
    const desiredTop = containerTop - offsetWithinMessage
    const delta = targetRect.top - desiredTop

    if (Math.abs(delta) > 0.5) {
      this.writeScrollTop(container.scrollTop + delta, 'programmatic')
    }
  }

  getDirectMeasurableRow(key: MessageRuntimeItemKey): MeasurableRow | null {
    const element = this.registry.getRow(key)

    return element ? { key, element } : null
  }

  async resolveMeasurableRowForTarget(input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    targetKey: MessageRuntimeItemKey
    targetIndex: number
    renderWindow: RenderWindow
    missingDomErrorCode: string
  }): Promise<MeasurableRow | null> {
    const direct = this.registry.getRow(input.targetKey)

    if (direct) {
      return { key: input.targetKey, element: direct }
    }

    // React ref 注册可能比 commit ack 晚一帧；先补等一帧，再决定是否 fallback。
    await this.nextFrame(input.data.feedId, input.data.generation)

    const retried = this.registry.getRow(input.targetKey)

    if (retried) {
      return { key: input.targetKey, element: retried }
    }

    const fallback = this.findNearestMeasurableRow(
      input.data.items,
      input.targetIndex,
      input.renderWindow,
    )

    if (fallback) {
      // 目标 DOM 缺失时宁可用邻近已测 row 保住大致位置，同时发 error 让接入层可观测。
      this.emitError(`${input.missingDomErrorCode}-fallback`)
      return fallback
    }

    this.emitError(input.missingDomErrorCode)
    return null
  }

  captureViewportAnchor(): AnchorState | null {
    const container = this.registry.getContainer()
    const snapshot = this.store.getSnapshot()

    if (!container) {
      return null
    }

    const containerTop = container.getBoundingClientRect().top

    for (const item of snapshot.items) {
      const key = getRuntimeItemKey(item)
      const element = this.registry.getRow(key)

      if (!element) {
        continue
      }

      const rect = element.getBoundingClientRect()

      if (rect.bottom >= containerTop) {
        // 选择第一个触达 viewport 顶边的 row，offset 表示顶边切入消息内部的距离。
        return {
          key,
          offsetWithinMessage: Math.max(0, containerTop - rect.top),
        }
      }
    }

    return null
  }

  private findNearestMeasurableRow(
    items: MessageDataItem<TMessage, TOptimistic>[],
    targetIndex: number,
    renderWindow: RenderWindow,
  ): MeasurableRow | null {
    const start = Math.max(0, renderWindow.startIndex)
    const end = Math.min(items.length - 1, renderWindow.endIndex)

    for (
      let distance = 0;
      distance <= Math.max(targetIndex - start, end - targetIndex);
      distance += 1
    ) {
      const before = targetIndex - distance
      const after = targetIndex + distance
      const candidates = before === after ? [before] : [before, after]

      for (const index of candidates) {
        if (index < start || index > end) {
          continue
        }

        const item = items[index]

        if (!item) {
          continue
        }

        const key = getRuntimeItemKey(item)
        const element = this.registry.getRow(key)

        if (element) {
          return { key, element }
        }
      }
    }

    return null
  }
}
