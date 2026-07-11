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
  getVisibleKeys: () => string[]
  reportDiagnostic: (
    name: string,
    severity: MessageListRuntimeLogDiagnosticRecord['severity'],
    details?: Record<string, unknown>,
  ) => void
}): MessageListSession<Row>['rows'] {
  return {
    patch: (rows) => {
      const items = toMessageDataItems(input.sessionId, rows, input.adapter)
      const loadedKeys = new Set(
        input.loadedSegmentStore.getSegment().items.map((item) => item.key),
      )
      const missingKeys = [
        ...new Set(
          items
            .filter((item) => !loadedKeys.has(item.key))
            .map((item) => item.key),
        ),
      ]
      if (missingKeys.length > 0) {
        input.reportDiagnostic(
          'rows.patch.missingKeyUpsertDeprecated',
          'warn',
          { missingKeys },
        )
      }
      input.publishSegment(
        input.loadedSegmentStore.patchItems(items),
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
        reason: mutation.reason,
      })

      if (segment === previousSegment) {
        return
      }

      input.publishSegment(segment)
    },
    replace: (replaceInput) => {
      if (
        input.loadedSegmentStore.getSegment().context === 'latest' &&
        replaceInput.hasMoreAfter
      ) {
        input.reportDiagnostic('rows.replace.latestBoundaryLost', 'warn')
      }
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
    invalidateAfter: ({ boundaryKey, reason }) => {
      const current = input.loadedSegmentStore.getSegment()
      const boundaryIndex = current.items.findIndex(
        (item) => item.key === boundaryKey,
      )
      if (boundaryIndex < 0) {
        return { status: 'rejected', reason: 'boundary-missing' }
      }

      const indexByKey = new Map(
        current.items.map((item, index) => [item.key, index]),
      )
      const overlapsVisibleRange = input.getVisibleKeys().some((key) => {
        const index = indexByKey.get(key)
        return index !== undefined && index > boundaryIndex
      })
      if (overlapsVisibleRange) {
        return { status: 'rejected', reason: 'visible-range-overlap' }
      }

      const isNoop = boundaryIndex === current.items.length - 1 &&
        current.hasMoreAfter &&
        current.context !== 'latest'
      if (isNoop) return { status: 'noop' }

      const invalidated = input.loadedSegmentStore.invalidateAfter(boundaryKey)
      if (!invalidated) {
        return { status: 'rejected', reason: 'boundary-missing' }
      }
      input.publishSegment(invalidated.segment)
      input.reportDiagnostic('rows.invalidateAfter.applied', 'debug', {
        boundaryKey,
        reason,
        removedCount: invalidated.removedKeys.length,
      })
      return {
        status: 'invalidated',
        ...(invalidated.removedKeys.length > 0
          ? { removedKeys: invalidated.removedKeys }
          : {}),
      }
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
