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
import {
  MessageListContractViolation,
  assertLatestPageContract,
} from '../session/contractDiagnostics'
import type {
  MessageListAdapter,
  MessageListRuntimeLogDiagnosticRecord,
  MessageListSessionId,
  MessageListSession,
} from '../contracts'

export function createSessionRows<Row, Source>(input: {
  sessionId: MessageListSessionId
  adapter: MessageListAdapter<Row, Source>
  loadedSegmentStore: LoadedSegmentStore<Row>
  publishSegment: (segment: LoadedSegment<Row>) => void
  publishLocalResetSegment: (segment: LoadedSegment<Row>) => void
  clearPendingLocal: () => void
  reportDiagnostic: (
    name: string,
    severity: MessageListRuntimeLogDiagnosticRecord['severity'],
    details?: Record<string, unknown>,
  ) => void
}): MessageListSession<Row>['rows'] {
  return {
    patch: (rows) => {
      input.publishSegment(
        input.loadedSegmentStore.patchItems(
          toMessageDataItems(input.sessionId, rows, input.adapter),
        ),
      )
    },
    mutate: (mutation) => {
      const previousSegment = input.loadedSegmentStore.getSegment()
      const segment = input.loadedSegmentStore.mutateItems({
        patches: mutation.patches
          ? toMessageDataItems(input.sessionId, mutation.patches, input.adapter)
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
        toSessionReplaceInput(input.sessionId, replaceInput, input.adapter),
      ))
    },
    resetLatest: (page) => {
      try {
        assertLatestPageContract(page, input.reportDiagnostic, {
          source: 'rows.resetLatest',
        })
      } catch (error) {
        if (error instanceof MessageListContractViolation) {
          return
        }
        throw error
      }
      input.clearPendingLocal()
      input.publishLocalResetSegment(
        input.loadedSegmentStore.resetLatest(
          toSessionResetInput(input.sessionId, page, input.adapter),
        ),
      )
    },
    resetAround: (resetInput) => {
      input.clearPendingLocal()
      input.publishLocalResetSegment(
        input.loadedSegmentStore.resetAround({
          ...toSessionResetInput(input.sessionId, resetInput, input.adapter),
          target: normalizeMessageListAnchor(input.sessionId, resetInput.target),
          align: resetInput.align,
          offsetWithinMessage: resetInput.offsetWithinMessage,
        }),
      )
    },
    applyIdentityRemap: (remaps) => {
      input.publishSegment(input.loadedSegmentStore.applyIdentityRemap(
        toSessionIdentityRemaps(input.sessionId, remaps),
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
