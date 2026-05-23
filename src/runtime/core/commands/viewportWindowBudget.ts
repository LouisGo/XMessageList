import type {
  MessageDataSnapshot,
  MessageViewportSnapshot,
} from '../../types'

export type ViewportWindowBudgetState = {
  spacerBudgetExceeded: boolean
  dataWindowItemBudgetExceeded: boolean
}

export function getViewportWindowBudgetState<TMessage, TOptimistic>(input: {
  spacerThresholdPx: number
  dataWindowItemThreshold: number
  viewportSnapshot: MessageViewportSnapshot<TMessage, TOptimistic>
  dataSnapshot: MessageDataSnapshot<TMessage, TOptimistic>
}): ViewportWindowBudgetState {
  return {
    spacerBudgetExceeded: isSpacerBudgetExceeded(
      input.spacerThresholdPx,
      input.viewportSnapshot,
    ),
    dataWindowItemBudgetExceeded: isDataWindowItemBudgetExceeded(
      input.dataWindowItemThreshold,
      input.dataSnapshot.items.length,
    ),
  }
}

export function shouldRebuildViewportWindow<TMessage, TOptimistic>(input: {
  spacerThresholdPx: number
  dataWindowItemThreshold: number
  viewportSnapshot: MessageViewportSnapshot<TMessage, TOptimistic>
  dataSnapshot: MessageDataSnapshot<TMessage, TOptimistic>
}): boolean {
  const budget = getViewportWindowBudgetState(input)

  return budget.spacerBudgetExceeded || budget.dataWindowItemBudgetExceeded
}

export function isSpacerBudgetExceeded<TMessage, TOptimistic>(
  spacerThresholdPx: number,
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): boolean {
  return (
    spacerThresholdPx > 0 &&
    (snapshot.topSpacer > spacerThresholdPx ||
      snapshot.bottomSpacer > spacerThresholdPx)
  )
}

export function isDataWindowItemBudgetExceeded(
  dataWindowItemThreshold: number,
  itemCount: number,
): boolean {
  return dataWindowItemThreshold > 0 && itemCount > dataWindowItemThreshold
}
