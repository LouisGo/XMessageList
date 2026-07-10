import type {
  LoadedSegment,
  MessageIdentityAnchor,
  MessageListRuntimeEvent,
} from '../../runtime/index'
import type {
  MessageListSessionRegistryRuntime,
  ProjectionCommitToken,
} from '../../runtime/internal'
import type { LoadedSegmentStore } from '../loaded-segment-store/index'
import type {
  MessageListAdapter,
  MessageListIdentityRemap,
  MessageListPage,
  MessageListReloadCurrentOptions,
  MessageListReloadCurrentResult,
  MessageListReloadCurrentStaleReason,
  MessageListLoadedContext,
  MessageListRequestResult,
  MessageListRowsMutation,
  MessageListSessionContext,
} from '../contracts'
import { MessageListContractViolation } from './contractDiagnostics'
import { toMessageDataItems } from '../adapters/rowAdapter'
import { toSessionIdentityRemaps } from './helpers'
import {
  MAX_RELOAD_JOURNAL_ENTRIES,
  ReloadContentJournal,
} from './reloadJournal'
import { prepareReloadProjection } from './reloadProjection'

type ReloadKind = 'latest' | 'around'
type ActivePhase = 'requesting' | 'settling'

type ActiveReload<Row> = {
  id: number
  requestKind: ReloadKind
  target?: MessageIdentityAnchor
  offsetWithinMessage?: number
  originContext: MessageListLoadedContext
  abortController: AbortController
  phase: ActivePhase
  navigationEpoch: number
  topologyEpoch: number
  lifecycleEpoch: number
  journal: ReloadContentJournal<Row>
  page?: MessageListPage<Row>
  expectedSegment?: Pick<ProjectionCommitToken, 'sessionId' | 'generation' | 'segmentRevision'>
  projectionApplied: boolean
  resolution?: 'exact' | 'fallback'
  resolvedAnchor?: MessageIdentityAnchor
  terminal: boolean
  resolve: (result: MessageListReloadCurrentResult<Row>) => void
}

export type ReloadMutationGuard<Row> = {
  applyRowsPatch(rows: Row[], apply: () => void): void
  applyVisibleRowsPatch(rows: Row[], apply: () => void): void
  applyRowsMutation(mutation: MessageListRowsMutation<Row>, apply: () => void): void
  applyIdentityRemap(remaps: MessageListIdentityRemap[], apply: () => void): void
  applyTailAppend(rows: Row[], retireKeys: string[] | undefined, apply: () => void): void
  applyTopologyMutation(apply: () => void): void
}

export class MessageListSessionReloadController<Row, Source> {
  private active: ActiveReload<Row> | null = null
  private reloadSequence = 0
  private navigationEpoch = 0
  private topologyEpoch = 0
  private lifecycleEpoch = 0
  private applyingOwnSegment = false
  private applyingRebasableMutation = false
  private destroyed = false

  constructor(private readonly options: {
    sessionId: string
    context: MessageListSessionContext<Source>
    adapter: MessageListAdapter<Row, Source>
    runtime: MessageListSessionRegistryRuntime<Row>
    loadedSegmentStore: LoadedSegmentStore<Row>
    getPageSize: () => number
    publishSegment: (segment: LoadedSegment<Row>) => void
    reportDiagnostic: (
      name: string,
      severity: 'debug' | 'info' | 'warn' | 'error',
      details?: Record<string, unknown>,
    ) => void
    onRequestResult?: (result: MessageListRequestResult<Row, Source>) => void
  }) {}

  reloadCurrent(
    options: MessageListReloadCurrentOptions,
  ): Promise<MessageListReloadCurrentResult<Row>> {
    this.invalidateActive('superseded')
    const requestKind = this.resolveRequestKind()

    if (this.destroyed) {
      return Promise.resolve({
        status: 'stale',
        requestKind,
        staleReason: 'session-destroyed',
      })
    }

    const current = requestKind === 'around'
      ? this.captureCurrentAnchor()
      : null

    if (requestKind === 'around' && !current) {
      const result = {
        status: 'failed' as const,
        requestKind,
        failureReason: 'anchor-unavailable' as const,
      }
      this.emitRequestResult(requestKind, result)
      return Promise.resolve(result)
    }

    const promise = new Promise<MessageListReloadCurrentResult<Row>>((resolve) => {
      const active: ActiveReload<Row> = {
        id: ++this.reloadSequence,
        requestKind,
        target: current?.anchor,
        offsetWithinMessage: current?.offsetWithinMessage,
        originContext: this.options.loadedSegmentStore.getSegment().context,
        abortController: new AbortController(),
        phase: 'requesting',
        navigationEpoch: this.navigationEpoch,
        topologyEpoch: this.topologyEpoch,
        lifecycleEpoch: this.lifecycleEpoch,
        journal: new ReloadContentJournal<Row>({
          toItems: (rows) => toMessageDataItems(
            this.options.sessionId,
            rows,
            this.options.adapter,
          ),
          toIdentityRemaps: (remaps) => toSessionIdentityRemaps(
            this.options.sessionId,
            remaps,
          ),
        }),
        projectionApplied: false,
        terminal: false,
        resolve,
      }
      this.active = active
      void this.run(active, options)
    })

    return promise
  }

  markNavigationChanged(): void {
    this.navigationEpoch += 1
    this.invalidateActive('navigation-changed')
  }

  markTopologyChanged(): void {
    this.topologyEpoch += 1
    if (
      this.active &&
      (
        this.applyingOwnSegment ||
        (this.applyingRebasableMutation && this.active.phase === 'requesting')
      )
    ) {
      this.active.topologyEpoch = this.topologyEpoch
      return
    }
    this.invalidateActive('topology-changed')
  }

  applyRowsPatch(rows: Row[], apply: () => void): void {
    this.applyJournaledMutation(
      (journal) => journal.recordPatch(rows),
      apply,
    )
  }

  applyVisibleRowsPatch(rows: Row[], apply: () => void): void {
    const visibleKeys = new Set(
      this.options.loadedSegmentStore.getSegment().items.map((item) => item.key),
    )
    const visibleRows = rows.filter((row) =>
      visibleKeys.has(this.options.adapter.row.getKey(row))
    )
    this.applyJournaledMutation(
      (journal) => journal.recordPatch(visibleRows),
      apply,
    )
  }

  applyRowsMutation(
    mutation: MessageListRowsMutation<Row>,
    apply: () => void,
  ): void {
    this.applyJournaledMutation(
      (journal, before) => journal.recordMutation(mutation, before.items),
      apply,
    )
  }

  applyIdentityRemap(
    remaps: MessageListIdentityRemap[],
    apply: () => void,
  ): void {
    this.applyJournaledMutation(
      (journal) => journal.recordIdentityRemap(remaps),
      apply,
    )
  }

  applyTailAppend(
    rows: Row[],
    retireKeys: string[] | undefined,
    apply: () => void,
  ): void {
    this.applyJournaledMutation(
      (journal, before) => journal.recordAppend(
        rows,
        retireKeys,
        before.items,
      ),
      apply,
    )
  }

  applyTopologyMutation(apply: () => void): void {
    this.markTopologyChanged()
    apply()
  }

  private applyJournaledMutation(
    record: (
      journal: ReloadContentJournal<Row>,
      before: LoadedSegment<Row>,
    ) => boolean,
    apply: () => void,
  ): void {
    const active = this.active
    if (!active || active.terminal) {
      apply()
      return
    }

    const before = this.options.loadedSegmentStore.getSegment()
    if (active.phase !== 'requesting') {
      apply()
      if (this.options.loadedSegmentStore.getSegment() !== before) {
        this.markTopologyChanged()
      }
      return
    }

    this.applyingRebasableMutation = true
    try {
      apply()
    } finally {
      this.applyingRebasableMutation = false
    }
    if (
      active.terminal ||
      this.options.loadedSegmentStore.getSegment() === before
    ) return
    if (!record(active.journal, before)) {
      this.options.reportDiagnostic(
        'reloadCurrent.contentJournalOverflow',
        'warn',
        { limit: MAX_RELOAD_JOURNAL_ENTRIES },
      )
      this.markTopologyChanged()
    }
  }

  handleRuntimeEvent(event: MessageListRuntimeEvent): void {
    const active = this.active
    if (!active || active.terminal || active.phase !== 'settling') return

    if (event.type === 'projectionSettled') {
      if (!active.expectedSegment || !sameSegment(
        active.expectedSegment,
        event.commitToken,
      )) {
        return
      }
      if (event.status === 'commit-timeout') {
        this.finish(active, {
          status: 'failed',
          requestKind: active.requestKind,
          failureReason: 'commit-timeout',
        })
        return
      }
      if (event.status === 'motion-cancelled') {
        this.finish(active, {
          status: 'stale',
          requestKind: active.requestKind,
          staleReason: 'navigation-changed',
        })
        return
      }
      active.projectionApplied = true
      this.finishApplied(active)
      return
    }

    if (
      event.type === 'destinationSettled' &&
      active.requestKind === 'around' &&
      active.expectedSegment &&
      event.generation === active.expectedSegment.generation &&
      event.segmentRevision === active.expectedSegment.segmentRevision
    ) {
      active.resolution = event.resolution === 'target' ? 'exact' : 'fallback'
      active.resolvedAnchor = event.resolvedTarget
      if (active.projectionApplied) this.finishApplied(active)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.lifecycleEpoch += 1
    this.invalidateActive('session-destroyed')
  }

  private async run(
    active: ActiveReload<Row>,
    options: MessageListReloadCurrentOptions,
  ): Promise<void> {
    try {
      const page = active.requestKind === 'latest'
        ? await this.options.adapter.request.loadLatest({
            ...this.options.context,
            pageSize: this.options.getPageSize(),
            trigger: 'command',
            reason: options.reason,
            signal: active.abortController.signal,
          })
        : await this.options.adapter.request.loadAround({
            ...this.options.context,
            pageSize: this.options.getPageSize(),
            trigger: 'command',
            reason: options.reason,
            target: active.target,
            signal: active.abortController.signal,
          })

      if (!this.isCurrent(active)) return
      const prepared = prepareReloadProjection({
        requestKind: active.requestKind,
        target: active.target,
        originContext: active.originContext,
        offsetWithinMessage: active.offsetWithinMessage,
        page,
        journal: active.journal,
        sessionId: this.options.sessionId,
        adapter: this.options.adapter,
        loadedSegmentStore: this.options.loadedSegmentStore,
        reportDiagnostic: this.options.reportDiagnostic,
      })
      if (!this.isCurrent(active)) return

      active.page = prepared.page
      active.resolution = prepared.resolution
      active.resolvedAnchor = prepared.resolvedAnchor
      active.phase = 'settling'
      this.applyingOwnSegment = true
      try {
        this.options.publishSegment(prepared.segment)
      } finally {
        this.applyingOwnSegment = false
      }
      const published = this.options.loadedSegmentStore.getSegment()
      active.expectedSegment = {
        sessionId: published.sessionId,
        generation: published.generation,
        segmentRevision: published.segmentRevision,
      }
    } catch (error) {
      if (active.terminal) return
      if (!this.isCurrent(active)) return
      const contractViolation = error instanceof MessageListContractViolation
      this.finish(active, {
        status: 'failed',
        requestKind: active.requestKind,
        failureReason: contractViolation
          ? 'contract-violation'
          : 'request-failed',
        error,
      })
    }
  }

  private resolveRequestKind(): ReloadKind {
    const snapshot = this.options.runtime.getSnapshot()
    if (
      snapshot.segmentMeta.context === 'latest' &&
      snapshot.bottomLockState === 'LOCKED' &&
      snapshot.segmentMeta.hasMoreAfter
    ) {
      this.options.reportDiagnostic(
        'reloadCurrent.invalidLatestBoundary',
        'error',
      )
    }
    return snapshot.segmentMeta.context === 'latest' &&
      snapshot.bottomLockState === 'LOCKED' &&
      !snapshot.segmentMeta.hasMoreAfter
      ? 'latest'
      : 'around'
  }

  private captureCurrentAnchor(): {
    anchor: MessageIdentityAnchor
    offsetWithinMessage?: number
  } | null {
    return this.options.runtime.getViewportAnchorMemory()
  }

  private isCurrent(active: ActiveReload<Row>): boolean {
    if (active.terminal || this.active !== active) return false
    if (this.destroyed || active.lifecycleEpoch !== this.lifecycleEpoch) {
      this.finish(active, {
        status: 'stale',
        requestKind: active.requestKind,
        staleReason: 'session-destroyed',
      })
      return false
    }
    if (active.navigationEpoch !== this.navigationEpoch) {
      this.finish(active, {
        status: 'stale',
        requestKind: active.requestKind,
        staleReason: 'navigation-changed',
      })
      return false
    }
    if (active.topologyEpoch !== this.topologyEpoch) {
      this.finish(active, {
        status: 'stale',
        requestKind: active.requestKind,
        staleReason: 'topology-changed',
      })
      return false
    }
    return true
  }

  private invalidateActive(reason: MessageListReloadCurrentStaleReason): void {
    const active = this.active
    if (!active || active.terminal) return
    active.abortController.abort()
    this.finish(active, {
      status: 'stale',
      requestKind: active.requestKind,
      staleReason: reason,
    })
  }

  private finishApplied(active: ActiveReload<Row>): void {
    const page = active.page
    if (!page) return
    this.finish(active, {
      status: 'applied',
      requestKind: active.requestKind,
      page,
      resolvedAnchor: active.resolvedAnchor,
      resolution: active.resolution,
    })
  }

  private finish(
    active: ActiveReload<Row>,
    result: MessageListReloadCurrentResult<Row>,
  ): void {
    if (active.terminal) return
    active.terminal = true
    if (this.active === active) this.active = null
    this.emitRequestResult(active.requestKind, result, active.page)
    active.resolve(result)
  }

  private emitRequestResult(
    requestKind: ReloadKind,
    result: MessageListReloadCurrentResult<Row>,
    page?: MessageListPage<Row>,
  ): void {
    this.options.onRequestResult?.({
      ...this.options.context,
      kind: requestKind,
      status: result.status === 'applied'
        ? 'applied'
        : result.status === 'stale'
          ? 'stale'
          : 'failed',
      trigger: 'command',
      page: result.status === 'applied' ? result.page : page,
      error: result.status === 'failed' ? result.error : undefined,
    })
  }
}

function sameSegment(
  left: Pick<ProjectionCommitToken, 'sessionId' | 'generation' | 'segmentRevision'>,
  right: ProjectionCommitToken,
): boolean {
  return left.sessionId === right.sessionId &&
    left.generation === right.generation &&
    left.segmentRevision === right.segmentRevision
}
