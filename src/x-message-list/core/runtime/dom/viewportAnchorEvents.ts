import {
  resolveAnchorFromSnapshot,
} from '../shared/snapshotIdentity'
import type { RuntimeDomRegistry } from './domRegistry'
import type { MessageIdentityAnchor } from '../contracts/identity'
import {
  captureVisualAnchor,
  type RuntimeMeasurement,
} from './measurement'
import type { MessageListSnapshot } from '../contracts/snapshot'

export type ResolvedViewportAnchor = {
  anchor: MessageIdentityAnchor | null
  offsetWithinMessage?: number
}

export type ViewportAnchorEventInput =
  | MessageIdentityAnchor
  | null
  | ResolvedViewportAnchor

// 优先实时捕获 viewport 顶部锚点；容器不可测时才回退到上次 runtime anchor。
export function resolveCurrentViewportAnchor<TMessage, TOptimistic>(input: {
  registry: RuntimeDomRegistry
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  fallbackAnchor: MessageIdentityAnchor | null
  lastAnchor: MessageIdentityAnchor | null
  lastAnchorOffsetWithinMessage: number | undefined
}): ResolvedViewportAnchor {
  const anchor = captureVisualAnchor(input.registry.snapshot())

  if (!anchor) {
    return {
      anchor: input.fallbackAnchor,
      offsetWithinMessage: input.fallbackAnchor &&
        input.lastAnchor &&
        isSameAnchorIdentity(input.fallbackAnchor, input.lastAnchor)
        ? input.lastAnchorOffsetWithinMessage
        : undefined,
    }
  }

  return {
    anchor: resolveAnchorFromSnapshot(input.snapshot, anchor.key) ??
      input.fallbackAnchor,
    offsetWithinMessage: anchor.offsetWithinMessage,
  }
}

export function resolveMeasuredViewportAnchor<TMessage, TOptimistic>(input: {
  registry: RuntimeDomRegistry
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  measurement: RuntimeMeasurement
  fallbackAnchor: MessageIdentityAnchor | null
  resolveCurrent: () => ResolvedViewportAnchor
}): ResolvedViewportAnchor {
  const container = input.registry.snapshot().scrollContainer

  if (!container) {
    return input.resolveCurrent()
  }

  const containerTop = container.getBoundingClientRect().top
  const measuredAnchor = [...input.measurement.visibleRows]
    .sort((first, second) => first.top - second.top)
    .find((row) => row.bottom > containerTop + 1)

  if (!measuredAnchor) {
    return input.resolveCurrent()
  }

  return {
    anchor: resolveAnchorFromSnapshot(input.snapshot, measuredAnchor.key) ??
      input.fallbackAnchor,
    offsetWithinMessage: Math.max(0, containerTop - measuredAnchor.top),
  }
}

export function resolveViewportAnchorEventInput(input: {
  eventInput: ViewportAnchorEventInput
  resolveCurrent: () => ResolvedViewportAnchor
}): ResolvedViewportAnchor {
  if (isResolvedViewportAnchor(input.eventInput)) {
    return input.eventInput
  }

  if (!input.eventInput) {
    return { anchor: input.eventInput }
  }

  // 调用方传入裸 anchor 时，只有它仍是当前可视锚点，才继承 offsetWithinMessage。
  const current = input.resolveCurrent()
  if (current.anchor && isSameAnchorIdentity(input.eventInput, current.anchor)) {
    return {
      anchor: input.eventInput,
      offsetWithinMessage: current.offsetWithinMessage,
    }
  }

  return { anchor: input.eventInput }
}

function isResolvedViewportAnchor(
  input: ViewportAnchorEventInput,
): input is ResolvedViewportAnchor {
  return Boolean(input && 'anchor' in input)
}

function isSameAnchorIdentity(
  left: MessageIdentityAnchor,
  right: MessageIdentityAnchor,
): boolean {
  return left.sessionId === right.sessionId &&
    (
      Boolean(left.serverId && left.serverId === right.serverId) ||
      left.stableId === right.stableId ||
      Boolean(left.localId && left.localId === right.localId)
    )
}
