import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../identity'
import type { LoadedSegment, SegmentModifier } from '../segment'
import {
  applyIdentityRemaps,
  dedupeItems,
  mergeAfterItems,
  mergeBeforeItems,
  patchSegmentItems,
  trimAroundKey,
} from './segmentOperations'

export type MessageListDataRuntimeOptions = {
  feedId: string
  itemBudget?: number
}

export type DataRuntimeRequestKind =
  | 'before'
  | 'after'
  | 'latest'
  | 'around'

export type DataRuntimeRequestToken = {
  requestToken: string
  generation: number
  kind: DataRuntimeRequestKind
}

export type DataRuntimeApplyResult<TMessage, TOptimistic> = {
  applied: boolean
  segment: LoadedSegment<TMessage, TOptimistic>
  reason?: 'stale-request'
}

export type ResetSegmentInput<TMessage, TOptimistic> = {
  items: MessageDataItem<TMessage, TOptimistic>[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  anchor?: MessageIdentityAnchor
  anchorStatus?: LoadedSegment['anchorStatus']
}

export type ExtendSegmentInput<TMessage, TOptimistic> =
  ResetSegmentInput<TMessage, TOptimistic> & {
    requestToken: string
  }

export type IdentityRemapInput = Extract<
  SegmentModifier,
  { type: 'identity-remap' }
>['remaps']

export class MessageListDataRuntime<TMessage = unknown, TOptimistic = unknown> {
  private generation = 0

  private segmentRevision = 0

  private requestSequence = 0

  private readonly pendingRequests = new Map<string, DataRuntimeRequestToken>()

  private segment: LoadedSegment<TMessage, TOptimistic>

  constructor(private readonly options: MessageListDataRuntimeOptions) {
    this.segment = {
      feedId: this.options.feedId,
      generation: this.generation,
      segmentRevision: this.segmentRevision,
      items: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
      modifier: { type: 'bootstrap' },
    }
  }

  getSegment(): LoadedSegment<TMessage, TOptimistic> {
    return this.segment
  }

  createRequestToken(kind: DataRuntimeRequestKind): DataRuntimeRequestToken {
    const request = {
      requestToken: `${this.options.feedId}:${kind}:${this.requestSequence + 1}`,
      generation: this.generation,
      kind,
    }
    this.requestSequence += 1
    this.pendingRequests.set(request.requestToken, request)
    return request
  }

  resetLatest(
    input: ResetSegmentInput<TMessage, TOptimistic>,
  ): LoadedSegment<TMessage, TOptimistic> {
    return this.reset(input, { type: 'reset-latest' })
  }

  resetAround(
    input: ResetSegmentInput<TMessage, TOptimistic> & {
      target: MessageIdentityAnchor
    },
  ): LoadedSegment<TMessage, TOptimistic> {
    return this.reset(input, { type: 'reset-around', target: input.target })
  }

  extendBefore(
    input: ExtendSegmentInput<TMessage, TOptimistic>,
  ): DataRuntimeApplyResult<TMessage, TOptimistic> {
    const request = this.consumeRequest(input.requestToken)

    if (!request) {
      return this.staleResult()
    }

    const items = mergeBeforeItems(input.items, this.segment.items)
    return this.applyItems(items, {
      input,
      modifier: { type: 'extend-before', requestToken: input.requestToken },
    })
  }

  extendAfter(
    input: ExtendSegmentInput<TMessage, TOptimistic>,
  ): DataRuntimeApplyResult<TMessage, TOptimistic> {
    const request = this.consumeRequest(input.requestToken)

    if (!request) {
      return this.staleResult()
    }

    const items = mergeAfterItems(this.segment.items, input.items)
    return this.applyItems(items, {
      input,
      modifier: { type: 'extend-after', requestToken: input.requestToken },
    })
  }

  patchItems(
    items: MessageDataItem<TMessage, TOptimistic>[],
  ): LoadedSegment<TMessage, TOptimistic> {
    this.segment = this.createSegment(
      patchSegmentItems(this.segment.items, items),
      {
        hasMoreBefore: this.segment.hasMoreBefore,
        hasMoreAfter: this.segment.hasMoreAfter,
        anchor: this.segment.anchor,
        anchorStatus: this.segment.anchorStatus,
        modifier: { type: 'patch', changedKeys: items.map((item) => item.key) },
      },
    )
    return this.segment
  }

  applyIdentityRemap(remaps: IdentityRemapInput): LoadedSegment<TMessage, TOptimistic> {
    this.segment = this.createSegment(
      applyIdentityRemaps(this.segment.items, remaps),
      {
        hasMoreBefore: this.segment.hasMoreBefore,
        hasMoreAfter: this.segment.hasMoreAfter,
        anchor: this.segment.anchor,
        anchorStatus: this.segment.anchorStatus,
        modifier: { type: 'identity-remap', remaps },
      },
    )
    return this.segment
  }

  trimToBudget(protectKey?: MessageRuntimeItemKey): LoadedSegment<TMessage, TOptimistic> {
    const budget = this.options.itemBudget

    if (!budget || this.segment.items.length <= budget) {
      return this.segment
    }

    const trimmed = trimAroundKey(this.segment.items, budget, protectKey)
    this.segment = this.createSegment(trimmed.items, {
      hasMoreBefore: this.segment.hasMoreBefore || trimmed.removedBefore > 0,
      hasMoreAfter: this.segment.hasMoreAfter || trimmed.removedAfter > 0,
      anchor: this.segment.anchor,
      anchorStatus: this.segment.anchorStatus,
      modifier: trimmed.removedBefore >= trimmed.removedAfter
        ? { type: 'trim-before', trimToken: `trim:${this.segmentRevision + 1}` }
        : { type: 'trim-after', trimToken: `trim:${this.segmentRevision + 1}` },
    })
    return this.segment
  }

  private reset(
    input: ResetSegmentInput<TMessage, TOptimistic>,
    modifier: SegmentModifier,
  ): LoadedSegment<TMessage, TOptimistic> {
    this.generation += 1
    this.pendingRequests.clear()
    this.segment = this.createSegment(dedupeItems(input.items), {
      ...input,
      modifier,
    })
    return this.segment
  }

  private applyItems(
    items: MessageDataItem<TMessage, TOptimistic>[],
    options: {
      input: ResetSegmentInput<TMessage, TOptimistic>
      modifier: SegmentModifier
    },
  ): DataRuntimeApplyResult<TMessage, TOptimistic> {
    this.segment = this.createSegment(dedupeItems(items), {
      ...options.input,
      modifier: options.modifier,
    })
    return { applied: true, segment: this.segment }
  }

  private consumeRequest(requestToken: string): DataRuntimeRequestToken | null {
    const request = this.pendingRequests.get(requestToken)
    this.pendingRequests.delete(requestToken)

    if (!request || request.generation !== this.generation) {
      return null
    }

    return request
  }

  private staleResult(): DataRuntimeApplyResult<TMessage, TOptimistic> {
    return {
      applied: false,
      segment: this.segment,
      reason: 'stale-request',
    }
  }

  private createSegment(
    items: MessageDataItem<TMessage, TOptimistic>[],
    input: {
      hasMoreBefore: boolean
      hasMoreAfter: boolean
      anchor?: MessageIdentityAnchor
      anchorStatus?: LoadedSegment['anchorStatus']
      modifier: SegmentModifier
    },
  ): LoadedSegment<TMessage, TOptimistic> {
    this.segmentRevision += 1
    return {
      feedId: this.options.feedId,
      generation: this.generation,
      segmentRevision: this.segmentRevision,
      items,
      hasMoreBefore: input.hasMoreBefore,
      hasMoreAfter: input.hasMoreAfter,
      anchor: input.anchor,
      anchorStatus: input.anchorStatus,
      modifier: input.modifier,
    }
  }
}

export function createMessageListDataRuntime<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  options: MessageListDataRuntimeOptions,
): MessageListDataRuntime<TMessage, TOptimistic> {
  return new MessageListDataRuntime<TMessage, TOptimistic>(options)
}
