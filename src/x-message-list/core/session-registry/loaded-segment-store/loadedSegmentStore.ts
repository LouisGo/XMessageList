import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../../runtime/contracts/identity'
import type {
  LoadedSegment,
  LoadedSegmentContext,
  ResetAroundAlign,
  SegmentModifier,
} from '../../runtime/contracts/segment'
import {
  applyIdentityRemaps,
  appendSegmentItems,
  dedupeItems,
  mergeAfterItems,
  mergeBeforeItems,
  mutateSegmentItems,
  patchSegmentItems,
  trimAroundKey,
} from './segmentOperations'
import {
  LoadedSegmentRequestTokenRegistry,
  type LoadedSegmentRequestKind,
  type LoadedSegmentRequestToken,
} from './requestTokenRegistry'

export type {
  LoadedSegmentRequestKind,
  LoadedSegmentRequestToken,
} from './requestTokenRegistry'

export type LoadedSegmentStoreOptions = {
  sessionId: string
}

export type LoadedSegmentStoreApplyResult<TMessage, TOptimistic> = {
  applied: boolean
  segment: LoadedSegment<TMessage, TOptimistic>
  reason?: 'stale-request'
}

/** 主 store 与 draft 之间的 compare-and-swap 基线。 */
export type LoadedSegmentStoreRevision = {
  generation: number
  segmentRevision: number
  topologyRevision: number
}

export type ResetSegmentInput<TMessage, TOptimistic> = {
  items: MessageDataItem<TMessage, TOptimistic>[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  context?: LoadedSegmentContext
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

export type MutateSegmentInput<TMessage, TOptimistic> = {
  patches?: MessageDataItem<TMessage, TOptimistic>[]
  removeKeys?: MessageRuntimeItemKey[]
  invalidateKeys?: MessageRuntimeItemKey[]
  reason?: string
}

export type IdentityRemapInput = Extract<
  SegmentModifier,
  { type: 'identity-remap' }
>['remaps']

/**
 * Loaded Segment Store 只负责把请求结果和本地变更规整成不可变 LoadedSegment；滚动、测量和 intent 仲裁都留给 viewport runtime。
 */
export class LoadedSegmentStore<TMessage = unknown, TOptimistic = unknown> {
  private generation = 0

  private segmentRevision = 0

  private topologyRevision = 0

  private readonly requestTokens: LoadedSegmentRequestTokenRegistry

  private segment: LoadedSegment<TMessage, TOptimistic>

  constructor(private readonly options: LoadedSegmentStoreOptions) {
    this.requestTokens = new LoadedSegmentRequestTokenRegistry(this.options.sessionId)
    this.segment = {
      sessionId: this.options.sessionId,
      generation: this.generation,
      segmentRevision: this.segmentRevision,
      items: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
      context: 'latest',
      modifier: { type: 'bootstrap' },
    }
  }

  getSegment(): LoadedSegment<TMessage, TOptimistic> {
    return this.segment
  }

  getRevision(): LoadedSegmentStoreRevision {
    return {
      generation: this.generation,
      segmentRevision: this.segmentRevision,
      topologyRevision: this.topologyRevision,
    }
  }

  /**
   * structural reload 在副本上构造候选窗口，主 store 在 DOM commit 前绝不前进。
   * request token registry 不需要复制：draft 只构造 reset projection，不发真实请求。
   */
  forkForProjection(): LoadedSegmentStore<TMessage, TOptimistic> {
    const fork = new LoadedSegmentStore<TMessage, TOptimistic>(this.options)
    fork.generation = this.generation
    fork.segmentRevision = this.segmentRevision
    fork.topologyRevision = this.topologyRevision
    fork.segment = this.segment
    return fork
  }

  /**
   * 只在 React commit ack 后采用 draft。CAS 失败说明有新 authoritative mutation
   * 绕过了 reload cancellation gate，调用方必须撤销候选 projection 而非覆盖新数据。
   */
  commitProjectionFork(
    fork: LoadedSegmentStore<TMessage, TOptimistic>,
    base: LoadedSegmentStoreRevision,
  ): boolean {
    const current = this.getRevision()
    if (
      current.generation !== base.generation ||
      current.segmentRevision !== base.segmentRevision ||
      current.topologyRevision !== base.topologyRevision
    ) {
      return false
    }

    this.generation = fork.generation
    this.segmentRevision = fork.segmentRevision
    this.topologyRevision = fork.topologyRevision
    this.segment = fork.segment
    this.requestTokens.reset()
    return true
  }

  createRequestToken(kind: LoadedSegmentRequestKind): LoadedSegmentRequestToken {
    return this.requestTokens.create(
      kind,
      this.generation,
      this.segmentRevision,
      this.topologyRevision,
    )
  }

  adoptRequestToken(
    request: LoadedSegmentRequestToken,
  ): void {
    this.requestTokens.adopt(
      request,
      this.generation,
      this.topologyRevision,
    )
  }

  cancelRequestToken(requestToken: string): boolean {
    return this.requestTokens.cancel(requestToken)
  }

  resetLatest(
    input: ResetSegmentInput<TMessage, TOptimistic>,
  ): LoadedSegment<TMessage, TOptimistic> {
    return this.reset({ ...input, context: 'latest' }, { type: 'reset-latest' })
  }

  resetLatestFromRequest(
    input: ResetSegmentInput<TMessage, TOptimistic> & { requestToken: string },
  ): LoadedSegmentStoreApplyResult<TMessage, TOptimistic> {
    if (!this.consumeRequest(input.requestToken, 'latest')) {
      return this.staleResult()
    }

    return {
      applied: true,
      segment: this.reset({ ...input, context: 'latest' }, { type: 'reset-latest' }),
    }
  }

  resetAround(
    input: ResetSegmentInput<TMessage, TOptimistic> & {
      target: MessageIdentityAnchor
      context?: LoadedSegmentContext
      align?: ResetAroundAlign
      offsetWithinMessage?: number
    },
  ): LoadedSegment<TMessage, TOptimistic> {
    return this.reset({ ...input, context: input.context ?? 'around' }, {
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
      context?: LoadedSegmentContext
      align?: ResetAroundAlign
      offsetWithinMessage?: number
    },
  ): LoadedSegmentStoreApplyResult<TMessage, TOptimistic> {
    if (!this.consumeRequest(input.requestToken, 'around')) {
      return this.staleResult()
    }

    return {
      applied: true,
      segment: this.reset({ ...input, context: input.context ?? 'around' }, {
        type: 'reset-around',
        target: input.target,
        align: input.align,
        offsetWithinMessage: input.offsetWithinMessage,
        requestToken: input.requestToken,
      }),
    }
  }

  extendBefore(
    input: ExtendSegmentInput<TMessage, TOptimistic>,
  ): LoadedSegmentStoreApplyResult<TMessage, TOptimistic> {
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
  ): LoadedSegmentStoreApplyResult<TMessage, TOptimistic> {
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
        context: this.segment.context,
        anchor: this.segment.anchor,
        anchorStatus: this.segment.anchorStatus,
        modifier: { type: 'patch', changedKeys: items.map((item) => item.key) },
      },
    )
    return this.segment
  }

  mutateItems(
    input: MutateSegmentInput<TMessage, TOptimistic>,
  ): LoadedSegment<TMessage, TOptimistic> {
    const mutation = mutateSegmentItems(this.segment.items, {
      patches: input.patches ?? [],
      removeKeys: input.removeKeys ?? [],
      invalidateKeys: input.invalidateKeys ?? [],
    })

    if (mutation.changedKeys.length === 0 && mutation.removed.length === 0) {
      return this.segment
    }

    const modifier: SegmentModifier = mutation.removed.length > 0
      ? {
          type: 'remove',
          changedKeys: mutation.changedKeys,
          removedKeys: mutation.removedKeys,
          removed: mutation.removed,
          firstAffectedIndex: mutation.firstAffectedIndex as number,
          ...(input.reason ? { reason: input.reason } : {}),
        }
      : {
          type: 'patch',
          changedKeys: mutation.changedKeys,
        }

    this.segment = this.createSegment(mutation.items, {
      hasMoreBefore: this.segment.hasMoreBefore,
      hasMoreAfter: this.segment.hasMoreAfter,
      context: this.segment.context,
      anchor: this.segment.anchor,
      anchorStatus: this.segment.anchorStatus,
      modifier,
    })
    return this.segment
  }

  appendItems(
    items: MessageDataItem<TMessage, TOptimistic>[],
    options: {
      follow: Extract<SegmentModifier, { type: 'append' }>['follow']
      retireKeys?: MessageRuntimeItemKey[]
    },
  ): LoadedSegment<TMessage, TOptimistic> {
    const retireKeys = options.retireKeys ?? []
    const changedKeys = [
      ...new Set([...retireKeys, ...items.map((item) => item.key)]),
    ]
    const modifier: Extract<SegmentModifier, { type: 'append' }> = {
      type: 'append',
      changedKeys,
      follow: options.follow,
    }

    if (retireKeys.length > 0) {
      modifier.retireKeys = retireKeys
    }

    this.segment = this.createSegment(
      appendSegmentItems(this.segment.items, items, retireKeys),
      {
        hasMoreBefore: this.segment.hasMoreBefore,
        hasMoreAfter: this.segment.hasMoreAfter,
        context: this.segment.context,
        anchor: this.segment.anchor,
        anchorStatus: this.segment.anchorStatus,
        modifier,
      },
    )
    return this.segment
  }

  replaceItems(
    input: ReplaceSegmentInput<TMessage, TOptimistic>,
  ): LoadedSegment<TMessage, TOptimistic> {
    const hasMoreAfter = input.hasMoreAfter ?? this.segment.hasMoreAfter
    this.segment = this.createSegment(dedupeItems(input.items), {
      hasMoreBefore: input.hasMoreBefore ?? this.segment.hasMoreBefore,
      hasMoreAfter,
      context: this.segment.context === 'latest' && hasMoreAfter
        ? 'history'
        : this.segment.context,
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
        context: this.segment.context,
        anchor: this.segment.anchor,
        anchorStatus: this.segment.anchorStatus,
        modifier: { type: 'identity-remap', remaps },
      },
    )
    return this.segment
  }

  trimToBudget(
    budget: number,
    protectKey?: MessageRuntimeItemKey,
  ): LoadedSegment<TMessage, TOptimistic> {
    if (budget <= 0 || this.segment.items.length <= budget) {
      return this.segment
    }

    const trimmed = trimAroundKey(this.segment.items, budget, protectKey)
    const context = this.segment.context === 'latest' && trimmed.removedAfter > 0
      ? 'history'
      : this.segment.context
    this.segment = this.createSegment(trimmed.items, {
      hasMoreBefore: this.segment.hasMoreBefore || trimmed.removedBefore > 0,
      hasMoreAfter: this.segment.hasMoreAfter || trimmed.removedAfter > 0,
      context,
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
  ): LoadedSegmentStoreApplyResult<TMessage, TOptimistic> {
    this.segment = this.createSegment(dedupeItems(items), {
      ...options.input,
      modifier: options.modifier,
    })
    return { applied: true, segment: this.segment }
  }

  private consumeRequest(
    requestToken: string,
    expectedKind: LoadedSegmentRequestKind,
  ): LoadedSegmentRequestToken | null {
    return this.requestTokens.consume(
      requestToken,
      expectedKind,
      this.generation,
      this.topologyRevision,
    )
  }

  private staleResult(): LoadedSegmentStoreApplyResult<TMessage, TOptimistic> {
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
      context?: LoadedSegmentContext
      anchor?: MessageIdentityAnchor
      anchorStatus?: LoadedSegment['anchorStatus']
      modifier: SegmentModifier
    },
  ): LoadedSegment<TMessage, TOptimistic> {
    if (hasBoundaryTopologyChange(this.segment, items, input)) {
      this.topologyRevision += 1
    }
    this.segmentRevision += 1
    return {
      sessionId: this.options.sessionId,
      generation: this.generation,
      segmentRevision: this.segmentRevision,
      items,
      hasMoreBefore: input.hasMoreBefore,
      hasMoreAfter: input.hasMoreAfter,
      context: input.context ?? this.segment.context,
      anchor: input.anchor,
      anchorStatus: input.anchorStatus,
      modifier: input.modifier,
    }
  }
}

function hasBoundaryTopologyChange<TMessage, TOptimistic>(
  previous: LoadedSegment<TMessage, TOptimistic>,
  items: MessageDataItem<TMessage, TOptimistic>[],
  input: {
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    context?: LoadedSegmentContext
  },
): boolean {
  return previous.items[0]?.key !== items[0]?.key ||
    previous.items.at(-1)?.key !== items.at(-1)?.key ||
    previous.hasMoreBefore !== input.hasMoreBefore ||
    previous.hasMoreAfter !== input.hasMoreAfter ||
    previous.context !== (input.context ?? previous.context)
}

export function createLoadedSegmentStore<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  options: LoadedSegmentStoreOptions,
): LoadedSegmentStore<TMessage, TOptimistic> {
  return new LoadedSegmentStore<TMessage, TOptimistic>(options)
}
