import type { LoadedSegment } from '../../runtime/index'
import type { LoadedSegmentStore } from '../loaded-segment-store/index'
import {
  normalizeMessageListAnchor,
  toMessageDataItems,
} from '../adapters/rowAdapter'
import {
  toSessionIdentityRemaps,
  toSessionReplaceInput,
  toSessionResetInput,
} from '../session/helpers'
import type {
  MessageListAdapter,
  MessageListSessionId,
  MessageListSession,
} from '../contracts'

export function createSessionRows<Row, Feed>(input: {
  id: MessageListSessionId
  adapter: MessageListAdapter<Row, Feed>
  loadedSegmentStore: LoadedSegmentStore<Row>
  publishSegment: (segment: LoadedSegment<Row>) => void
  publishLocalResetSegment: (segment: LoadedSegment<Row>) => void
  clearPendingLocal: () => void
}): MessageListSession<Row>['rows'] {
  return {
    patch: (rows) => {
      input.publishSegment(
        input.loadedSegmentStore.patchItems(
          toMessageDataItems(input.id, rows, input.adapter),
        ),
      )
    },
    mutate: (mutation) => {
      const previousSegment = input.loadedSegmentStore.getSegment()
      const segment = input.loadedSegmentStore.mutateItems({
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
      input.publishSegment(input.loadedSegmentStore.replaceItems(
        toSessionReplaceInput(input.id, replaceInput, input.adapter),
      ))
    },
    resetLatest: (page) => {
      input.clearPendingLocal()
      input.publishLocalResetSegment(
        input.loadedSegmentStore.resetLatest(
          toSessionResetInput(input.id, page, input.adapter),
        ),
      )
    },
    resetAround: (resetInput) => {
      input.clearPendingLocal()
      input.publishLocalResetSegment(
        input.loadedSegmentStore.resetAround({
          ...toSessionResetInput(input.id, resetInput, input.adapter),
          target: normalizeMessageListAnchor(input.id, resetInput.target),
          align: resetInput.align,
          offsetWithinMessage: resetInput.offsetWithinMessage,
        }),
      )
    },
    applyIdentityRemap: (remaps) => {
      input.publishSegment(input.loadedSegmentStore.applyIdentityRemap(
        toSessionIdentityRemaps(input.id, remaps),
      ))
    },
    clear: () => {
      input.clearPendingLocal()
      input.publishLocalResetSegment(
        input.loadedSegmentStore.resetLatest({
          items: [],
          hasMoreBefore: false,
          hasMoreAfter: false,
        }),
      )
    },
  }
}
