import type { LoadedSegment, MessageListRuntime } from '../../runtime/index'
import type { LoadedSegmentStore } from '../loaded-segment-store/index'
import { reindexRows, type SessionDefaults } from './helpers'
import { prepareSessionSegmentForPublish } from './publishSegment'

type SessionSegmentPublisherOptions<Row> = {
  initialSegment: LoadedSegment<Row>
  runtime: MessageListRuntime<Row>
  loadedSegmentStore: LoadedSegmentStore<Row>
  defaults: SessionDefaults
  rowsByKey: Map<string, Row>
  getRowsPerViewportEstimate(): number
  settlePendingLocalForSegment(segment: LoadedSegment<Row>): void
  notifyLoadedChanged(): void
}

/**
 * Owns the session's committed projection. A reload draft can prepare against
 * a fork, but this object advances the public row/read-receipt view only after
 * the runtime acknowledges its DOM transaction.
 */
export class MessageListSessionSegmentPublisher<Row> {
  private committedSegment: LoadedSegment<Row>

  constructor(private readonly options: SessionSegmentPublisherOptions<Row>) {
    this.committedSegment = options.initialSegment
  }

  getCommittedSegment(): LoadedSegment<Row> {
    return this.committedSegment
  }

  publish(segment: LoadedSegment<Row>): boolean {
    const prepared = this.prepare(segment, this.options.loadedSegmentStore)
    this.committedSegment = prepared.segment
    this.settleCommittedSegment(prepared.segment)
    this.options.runtime.applyLoadedSegment(prepared.segment)
    return prepared.topologyChanged
  }

  prepareStaged(
    segment: LoadedSegment<Row>,
    draftStore: LoadedSegmentStore<Row>,
  ): LoadedSegment<Row> {
    return this.prepare(segment, draftStore).segment
  }

  finalizeStaged(segment: LoadedSegment<Row>): void {
    // The DOM settle is the commit point; before it, state.loaded must keep the old rows.
    this.committedSegment = segment
    this.settleCommittedSegment(segment)
    this.options.notifyLoadedChanged()
  }

  private prepare(
    segment: LoadedSegment<Row>,
    loadedSegmentStore: LoadedSegmentStore<Row>,
  ): { segment: LoadedSegment<Row>; topologyChanged: boolean } {
    return prepareSessionSegmentForPublish({
      segment,
      previous: this.committedSegment,
      runtime: this.options.runtime,
      loadedSegmentStore,
      defaults: this.options.defaults,
      rowsPerViewportEstimate: this.options.getRowsPerViewportEstimate(),
    })
  }

  private settleCommittedSegment(segment: LoadedSegment<Row>): void {
    this.options.settlePendingLocalForSegment(segment)
    reindexRows(this.options.rowsByKey, segment.items)
  }
}
