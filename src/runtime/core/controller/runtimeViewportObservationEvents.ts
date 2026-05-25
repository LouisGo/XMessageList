import type { DomRegistry } from '../../dom/domRegistry'
import type { ProjectionStore } from '../state/projectionStore'
import type {
  AnchorState,
  MessageDataSnapshot,
  MessageRuntimeItemKey,
  ScrollSource,
  ViewportObservationChangedEvent,
  ViewportObservationReason,
  ViewportScrollDirection,
} from '../../types'
import {
  getRuntimeItemKey,
  serializeRuntimeItemKey,
} from '../../shared/utils'
import { cloneAnchorState } from '../state/runtimeTypes'

type RuntimeViewportObservationEventsDeps<TMessage, TOptimistic> = {
  registry: DomRegistry
  store: ProjectionStore<TMessage, TOptimistic>
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  getLastScrollSource: () => ScrollSource | null
  captureViewportAnchor: () => AnchorState | null
  hasViewportObservationListeners: () => boolean
  emitViewportObservation: (event: ViewportObservationChangedEvent) => void
}

const OBSERVATION_SCROLL_EPSILON_PX = 0.5
const VISIBLE_RATIO_PRECISION = 1000

export class RuntimeViewportObservationEvents<TMessage, TOptimistic> {
  private lastScrollTop: number | null = null
  private lastDirection: ViewportScrollDirection = null
  private lastSignature: string | null = null

  constructor(
    private readonly deps: RuntimeViewportObservationEventsDeps<
      TMessage,
      TOptimistic
    >,
  ) {}

  emitChanged(
    reason: ViewportObservationReason,
    scrollSource = this.deps.getLastScrollSource(),
  ): void {
    if (!this.deps.hasViewportObservationListeners()) {
      return
    }

    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const direction = this.resolveDirection(container.scrollTop)
    const snapshot = this.deps.store.getSnapshot()
    const visibleItems = snapshot.items.flatMap((item) => {
      const key = getRuntimeItemKey(item)
      const element = this.deps.registry.getRow(key)

      if (!element) {
        return []
      }

      const visibleRatio = readVisibleRatio(container, element)

      if (visibleRatio <= 0) {
        return []
      }

      return [{ key: cloneRuntimeItemKey(key), visibleRatio }]
    })
    const firstItem = visibleItems[0] ?? null
    const lastItem = visibleItems[visibleItems.length - 1] ?? null
    const anchor = this.deps.captureViewportAnchor()
    const event: ViewportObservationChangedEvent = {
      type: 'viewportObservationChanged',
      feedId: data.feedId,
      generation: data.generation,
      reason,
      scrollSource,
      direction,
      activity: {
        phase: reason === 'scroll-frame' ? 'scrolling' : 'idle',
        direction,
      },
      anchor: anchor ? cloneAnchorState(anchor) : null,
      visibleRange: {
        firstKey: firstItem ? cloneRuntimeItemKey(firstItem.key) : null,
        lastKey: lastItem ? cloneRuntimeItemKey(lastItem.key) : null,
      },
      visibleItems,
    }
    const signature = createObservationSignature(event)

    if (signature === this.lastSignature) {
      return
    }

    this.lastSignature = signature
    this.deps.emitViewportObservation(event)
  }

  reset(): void {
    this.lastScrollTop = null
    this.lastDirection = null
    this.lastSignature = null
  }

  private resolveDirection(scrollTop: number): ViewportScrollDirection {
    const previous = this.lastScrollTop
    this.lastScrollTop = scrollTop

    if (previous === null) {
      return this.lastDirection
    }

    const delta = scrollTop - previous

    if (Math.abs(delta) <= OBSERVATION_SCROLL_EPSILON_PX) {
      return this.lastDirection
    }

    this.lastDirection = delta > 0 ? 'down' : 'up'
    return this.lastDirection
  }
}

function readVisibleRatio(container: HTMLElement, element: HTMLElement): number {
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const elementHeight = elementRect.height

  if (elementHeight <= 0) {
    return 0
  }

  const visibleHeight = Math.min(containerRect.bottom, elementRect.bottom) -
    Math.max(containerRect.top, elementRect.top)
  const ratio = Math.min(1, Math.max(0, visibleHeight / elementHeight))

  return Math.round(ratio * VISIBLE_RATIO_PRECISION) / VISIBLE_RATIO_PRECISION
}

function cloneRuntimeItemKey(key: MessageRuntimeItemKey): MessageRuntimeItemKey {
  return key.kind === 'committed'
    ? { kind: 'committed', messageId: key.messageId }
    : { kind: 'optimistic', clientMessageId: key.clientMessageId }
}

function createObservationSignature(
  event: ViewportObservationChangedEvent,
): string {
  const visibleItems = event.visibleItems
    .map(
      (item) =>
        `${serializeRuntimeItemKey(item.key)}:${item.visibleRatio.toFixed(3)}`,
    )
    .join('|')
  const anchor = event.anchor
    ? `${serializeRuntimeItemKey(event.anchor.key)}:${event.anchor.offsetWithinMessage.toFixed(1)}`
    : 'null'

  return [
    event.feedId,
    event.generation,
    event.reason,
    event.scrollSource,
    event.direction,
    anchor,
    visibleItems,
  ].join(';')
}
