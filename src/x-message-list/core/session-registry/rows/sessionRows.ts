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
  probeInvalidateAfterSafety: (input: { suffixKeys: string[] }) =>
    | 'safe'
    | 'runtime-busy'
    | 'visible-range-overlap'
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

      const suffixKeys = current.items
        .slice(boundaryIndex + 1)
        .map((item) => item.key)
      const suffixKeySet = new Set(suffixKeys)
      if (input.getVisibleKeys().some((key) => suffixKeySet.has(key))) {
        return { status: 'rejected', reason: 'visible-range-overlap' }
      }

      // safety probe 在 runtime owner 内一次性验证 phase、事务、motion、scroll frame
      // 和实时 DOM 可见区，避免分散 getter 之间出现 TOCTOU 窗口。
      const safety = input.probeInvalidateAfterSafety({
        suffixKeys,
      })
      if (safety !== 'safe') {
        return { status: 'rejected', reason: safety }
      }

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
