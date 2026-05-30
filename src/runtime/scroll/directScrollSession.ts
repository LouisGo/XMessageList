import type { RuntimeEdge } from '../state/interactionTypes'
import type { SegmentModifier } from '../contracts/segment'

type DirectScrollSessionState =
  | { status: 'IDLE' }
  | { status: 'DRAGGING' }
  | { status: 'EDGE_PENDING'; edge: RuntimeEdge; requestToken: string }
  | { status: 'REBOUND_BLOCKED'; edge: RuntimeEdge }
  | { status: 'DRAGGING_REBASED' }

export type DirectScrollSessionSnapshot = DirectScrollSessionState & {
  edgeIntent: RuntimeEdge | null
}

export class DirectScrollSession {
  private state: DirectScrollSessionState = { status: 'IDLE' }

  private edgeIntent: RuntimeEdge | null = null

  private rebasedWhilePending = false

  begin(): DirectScrollSessionSnapshot {
    this.state = { status: 'DRAGGING' }
    this.edgeIntent = null
    this.rebasedWhilePending = false
    return this.snapshot()
  }

  recordWrite(edgeIntent: RuntimeEdge | null): DirectScrollSessionSnapshot {
    if (this.state.status === 'IDLE') {
      return this.snapshot()
    }

    if (this.state.status === 'EDGE_PENDING') {
      this.edgeIntent = null
      return this.snapshot()
    }

    if (
      this.state.status === 'REBOUND_BLOCKED' &&
      this.state.edge === edgeIntent
    ) {
      this.edgeIntent = null
      return this.snapshot()
    }

    this.edgeIntent = edgeIntent
    return this.snapshot()
  }

  getConsumableEdgeIntent(): RuntimeEdge | null {
    if (
      this.state.status === 'IDLE' ||
      this.state.status === 'EDGE_PENDING'
    ) {
      return null
    }

    if (
      this.state.status === 'REBOUND_BLOCKED' &&
      this.state.edge === this.edgeIntent
    ) {
      return null
    }

    return this.edgeIntent
  }

  markEdgeConsumed(
    edge: RuntimeEdge,
    requestToken: string,
  ): DirectScrollSessionSnapshot | null {
    if (this.getConsumableEdgeIntent() !== edge) {
      return null
    }

    this.state = { status: 'EDGE_PENDING', edge, requestToken }
    this.edgeIntent = null
    this.rebasedWhilePending = false
    return this.snapshot()
  }

  settleSegment(modifier: SegmentModifier): DirectScrollSessionSnapshot | null {
    if (this.state.status !== 'EDGE_PENDING') {
      return null
    }

    if (!isMatchingExtend(modifier, this.state.edge, this.state.requestToken)) {
      return null
    }

    this.state = this.rebasedWhilePending
      ? { status: 'DRAGGING_REBASED' }
      : { status: 'REBOUND_BLOCKED', edge: this.state.edge }
    this.edgeIntent = null
    this.rebasedWhilePending = false
    return this.snapshot()
  }

  markRebased(): DirectScrollSessionSnapshot | null {
    if (this.state.status === 'IDLE') {
      return null
    }

    if (this.state.status === 'EDGE_PENDING') {
      this.rebasedWhilePending = true
      this.edgeIntent = null
      return this.snapshot()
    }

    this.state = { status: 'DRAGGING_REBASED' }
    this.edgeIntent = null
    return this.snapshot()
  }

  end(): DirectScrollSessionSnapshot {
    this.state = { status: 'IDLE' }
    this.edgeIntent = null
    this.rebasedWhilePending = false
    return this.snapshot()
  }

  snapshot(): DirectScrollSessionSnapshot {
    return {
      ...this.state,
      edgeIntent: this.edgeIntent,
    }
  }
}

function isMatchingExtend(
  modifier: SegmentModifier,
  edge: RuntimeEdge,
  requestToken: string,
): boolean {
  return (
    edge === 'before' &&
    modifier.type === 'extend-before' &&
    modifier.requestToken === requestToken
  ) || (
    edge === 'after' &&
    modifier.type === 'extend-after' &&
    modifier.requestToken === requestToken
  )
}
