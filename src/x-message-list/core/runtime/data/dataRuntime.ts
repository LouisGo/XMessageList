import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../contracts/identity'
import type {
  LoadedSegment,
  ResetAroundAlign,
  SegmentModifier,
} from '../contracts/segment'
import {
  applyIdentityRemaps,
  dedupeItems,
  mergeAfterItems,
  mergeBeforeItems,
  patchSegmentItems,
  trimAroundKey,
} from './segmentOperations'
import {
  DataRuntimeRequestTokenRegistry,
  type DataRuntimeRequestKind,
  type DataRuntimeRequestToken,
} from './requestTokenRegistry'

export type {
  DataRuntimeRequestKind,
  DataRuntimeRequestToken,
} from './requestTokenRegistry'

export type MessageListDataRuntimeOptions = {
  feedId: string
  itemBudget?: number
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

export type ReplaceSegmentInput<TMessage, TOptimistic> = {
  items: MessageDataItem<TMessage, TOptimistic>[]
  changedKeys: MessageRuntimeItemKey[]
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
  anchor?: MessageIdentityAnchor
  anchorStatus?: LoadedSegment['anchorStatus']
}

export type IdentityRemapInput = Extract<
  SegmentModifier,
  { type: 'identity-remap' }
>['remaps']

/**
 * Data runtime 只负责把请求结果和本地变更规整成不可变 LoadedSegment；滚动、测量和 intent 仲裁都留给 viewport runtime。
 */
export class MessageListDataRuntime<TMessage = unknown, TOptimistic = unknown> {
  private generation = 0

  private segmentRevision = 0

  private readonly requestTokens: DataRuntimeRequestTokenRegistry

  private segment: LoadedSegment<TMessage, TOptimistic>

  constructor(private readonly options: MessageListDataRuntimeOptions) {
    this.requestTokens = new DataRuntimeRequestTokenRegistry(this.options.feedId)
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
    return this.requestTokens.create(kind, this.generation, this.segmentRevision)
  }

  adoptRequestToken(
    request: DataRuntimeRequestToken,
  ): void {
    this.requestTokens.adopt(request, this.generation, this.segmentRevision)
  }

  resetLatest(
    input: ResetSegmentInput<TMessage, TOptimistic>,
  ): LoadedSegment<TMessage, TOptimistic> {
    return this.reset(input, { type: 'reset-latest' })
  }

  resetLatestFromRequest(
    input: ResetSegmentInput<TMessage, TOptimistic> & { requestToken: string },
  ): DataRuntimeApplyResult<TMessage, TOptimistic> {
    if (!this.consumeRequest(input.requestToken, 'latest')) {
      return this.staleResult()
    }

    return {
      applied: true,
      segment: this.reset(input, { type: 'reset-latest' }),
    }
  }

  resetAround(
    input: ResetSegmentInput<TMessage, TOptimistic> & {
      target: MessageIdentityAnchor
      align?: ResetAroundAlign
      offsetWithinMessage?: number
    },
  ): LoadedSegment<TMessage, TOptimistic> {
    return this.reset(input, {
      type: 'reset-around',
      target: input.target,
      align: input.align,
      offsetWithinMessage: input.offsetWithinMessage,
    })
  }

  resetAroundFromRequest(
    input: ResetSegmentInput<TMessage, TOptimistic> & {
      target: MessageIdentityAnchor
      requestToken: string
      align?: ResetAroundAlign
      offsetWithinMessage?: number
    },
  ): DataRuntimeApplyResult<TMessage, TOptimistic> {
    if (!this.consumeRequest(input.requestToken, 'around')) {
      return this.staleResult()
    }

    return {
      applied: true,
      segment: this.reset(input, {
        type: 'reset-around',
        target: input.target,
        align: input.align,
        offsetWithinMessage: input.offsetWithinMessage,
      }),
    }
  }

  extendBefore(
    input: ExtendSegmentInput<TMessage, TOptimistic>,
  ): DataRuntimeApplyResult<TMessage, TOptimistic> {
    const request = this.consumeRequest(input.requestToken, 'before')

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
    const request = this.consumeRequest(input.requestToken, 'after')

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

  replaceItems(
    input: ReplaceSegmentInput<TMessage, TOptimistic>,
  ): LoadedSegment<TMessage, TOptimistic> {
    this.segment = this.createSegment(dedupeItems(input.items), {
      hasMoreBefore: input.hasMoreBefore ?? this.segment.hasMoreBefore,
      hasMoreAfter: input.hasMoreAfter ?? this.segment.hasMoreAfter,
      anchor: input.anchor ?? this.segment.anchor,
      anchorStatus: input.anchorStatus ?? this.segment.anchorStatus,
      modifier: { type: 'patch', changedKeys: input.changedKeys },
    })
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
    this.requestTokens.reset()
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

  private consumeRequest(
    requestToken: string,
    expectedKind: DataRuntimeRequestKind,
  ): DataRuntimeRequestToken | null {
    return this.requestTokens.consume(
      requestToken,
      expectedKind,
      this.generation,
      this.segmentRevision,
    )
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
