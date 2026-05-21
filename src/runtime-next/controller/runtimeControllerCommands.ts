import type { DataArrivalIntent, PendingDataIntent } from '../data/classifier.types'
import type { MessageDataSnapshot } from '../data/types'
import type {
  AnchorState,
  MessageIdentityAnchor,
} from '../identity/types'
import type { RuntimeTransactionIntent } from '../transactions/types'
import {
  createNeedLatestEvent,
  createNeedMessagesAroundEvent,
  isTargetAvailable,
} from './controllerHelpers'

export type RuntimeCommandContext<TMessage, TOptimistic> = {
  readonly getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  readonly ids: () => { readonly feedId: string; readonly generation: number }
  readonly enqueue: (
    intent: RuntimeTransactionIntent<TMessage, TOptimistic>,
  ) => void
  readonly setPendingDataIntent: (intent: PendingDataIntent) => void
  readonly emitEvent: (
    event:
      | ReturnType<typeof createNeedLatestEvent>
      | ReturnType<typeof createNeedMessagesAroundEvent>,
  ) => void
}

export function dispatchFollowBottom<TMessage, TOptimistic>(
  ctx: RuntimeCommandContext<TMessage, TOptimistic>,
): void {
  const snapshot = ctx.getDataSnapshot()
  if (snapshot === null || snapshot.hasMoreAfter) {
    ctx.setPendingDataIntent({
      kind: 'followBottom',
      origin: 'user-command',
      priority: 'latest',
    })
    ctx.emitEvent(createNeedLatestEvent(ctx.ids()))
    return
  }
  ctx.enqueue({ kind: 'followBottom', origin: 'user-command' })
}

export function dispatchDestination<TMessage, TOptimistic>(
  ctx: RuntimeCommandContext<TMessage, TOptimistic>,
  kind: 'jump' | 'restore',
  target: MessageIdentityAnchor | AnchorState,
): void {
  const snapshot = ctx.getDataSnapshot()
  if (snapshot === null || !isTargetAvailable(snapshot.items, target)) {
    ctx.setPendingDataIntent({
      kind,
      target,
      origin: 'user',
      priority: 'destination',
    } as PendingDataIntent)
    ctx.emitEvent(createNeedMessagesAroundEvent({
      ...ctx.ids(),
      reason: kind,
      target,
    }))
    return
  }
  ctx.enqueue({
    kind,
    target,
    origin: 'user',
  } as RuntimeTransactionIntent<TMessage, TOptimistic>)
}

export function enqueueDataIntent<TMessage, TOptimistic>(
  ctx: Pick<RuntimeCommandContext<TMessage, TOptimistic>, 'enqueue'>,
  intent: DataArrivalIntent,
): void {
  if (intent.kind === 'no-op') return
  if (intent.kind === 'projectionRefresh') ctx.enqueue({ kind: 'projectionRefresh' })
  if (intent.kind === 'segmentRelayout') {
    ctx.enqueue({ kind: 'segmentRelayout', reason: intent.reason })
  }
  if (intent.kind === 'segmentShift') {
    ctx.enqueue({
      kind: 'segmentShift',
      direction: intent.direction,
      source: 'data',
    })
  }
  if (intent.kind === 'followBottom') {
    ctx.enqueue({ kind: 'followBottom', origin: intent.origin })
  }
  if (intent.kind === 'jump') {
    ctx.enqueue({ kind: 'jump', target: intent.target, origin: 'user' })
  }
  if (intent.kind === 'restore') {
    ctx.enqueue({ kind: 'restore', target: intent.target, origin: 'lifecycle' })
  }
  if (intent.kind === 'reset') ctx.enqueue({ kind: 'reset', reason: intent.reason })
}
