import type { LoadedSegment } from '../runtime/index'
import type { MessageListDataRuntime } from '../runtime/data/index'
import {
  normalizeMessageListAnchor,
  toMessageDataItems,
} from './rowAdapter'
import {
  toSessionIdentityRemaps,
  toSessionReplaceInput,
  toSessionResetInput,
} from './sessionHelpers'
import type {
  MessageListAdapter,
  MessageListConversationId,
  MessageListSession,
} from './types'

export function createSessionRows<Row, Conversation>(input: {
  id: MessageListConversationId
  adapter: MessageListAdapter<Row, Conversation>
  dataRuntime: MessageListDataRuntime<Row>
  publishSegment: (segment: LoadedSegment<Row>) => void
  publishLocalResetSegment: (segment: LoadedSegment<Row>) => void
  clearPendingOutgoing: () => void
}): MessageListSession<Row>['rows'] {
  return {
    patch: (rows) => {
      input.publishSegment(
        input.dataRuntime.patchItems(
          toMessageDataItems(input.id, rows, input.adapter),
        ),
      )
    },
    mutate: (mutation) => {
      const previousSegment = input.dataRuntime.getSegment()
      const segment = input.dataRuntime.mutateItems({
        patches: mutation.patches
          ? toMessageDataItems(input.id, mutation.patches, input.adapter)
          : undefined,
        removeKeys: mutation.removeKeys,
        invalidateKeys: mutation.invalidateKeys,
      })

      if (segment === previousSegment) {
        return
      }

      input.publishSegment(segment)
    },
    replace: (replaceInput) => {
      input.publishSegment(input.dataRuntime.replaceItems(
        toSessionReplaceInput(input.id, replaceInput, input.adapter),
      ))
    },
    resetLatest: (page) => {
      input.clearPendingOutgoing()
      input.publishLocalResetSegment(
        input.dataRuntime.resetLatest(
          toSessionResetInput(input.id, page, input.adapter),
        ),
      )
    },
    resetAround: (resetInput) => {
      input.clearPendingOutgoing()
      input.publishLocalResetSegment(
        input.dataRuntime.resetAround({
          ...toSessionResetInput(input.id, resetInput, input.adapter),
          target: normalizeMessageListAnchor(input.id, resetInput.target),
          align: resetInput.align,
          offsetWithinMessage: resetInput.offsetWithinMessage,
        }),
      )
    },
    applyIdentityRemap: (remaps) => {
      input.publishSegment(input.dataRuntime.applyIdentityRemap(
        toSessionIdentityRemaps(input.id, remaps),
      ))
    },
    clear: () => {
      input.clearPendingOutgoing()
      input.publishLocalResetSegment(
        input.dataRuntime.resetLatest({
          items: [],
          hasMoreBefore: false,
          hasMoreAfter: false,
        }),
      )
    },
  }
}
