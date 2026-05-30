import type {
  MessageIdentityAnchor,
  MessageListRuntime,
  MessageListRuntimeEvent,
  ResetAroundAlign,
} from '../runtime'
import type { MessageListDataRuntime } from '../runtime/data'
import { toDemoMessageDataItem, type DemoMessage } from './demoData'
import { getLatestMessages, getMessagesAround } from './demoMessageApi'
import type { MessageIdentityAnchor as DemoApiAnchor } from './demoMessageApiTypes'

type NeedMoreBeforeEvent = Extract<
  MessageListRuntimeEvent,
  { type: 'needMoreBefore' }
>
type NeedMoreAfterEvent = Extract<
  MessageListRuntimeEvent,
  { type: 'needMoreAfter' }
>
type NeedLatestMessagesEvent = Extract<
  MessageListRuntimeEvent,
  { type: 'needLatestMessages' }
>
type NeedMessagesAroundEvent = Extract<
  MessageListRuntimeEvent,
  { type: 'needMessagesAround' }
>

export type DemoRequestResult = {
  status: 'applied' | 'failed' | 'stale'
  message: string
  total?: number
}

export type DemoRequestContext = {
  dataRuntime: MessageListDataRuntime<DemoMessage>
  runtime: MessageListRuntime<DemoMessage>
  publishSegment: (dataRuntime: MessageListDataRuntime<DemoMessage>) => void
  pageSize: number
  isStale?: () => boolean
}

export async function applyLatestRequest(
  context: DemoRequestContext & {
    feedId: string
    event?: NeedLatestMessagesEvent
  },
): Promise<DemoRequestResult> {
  const { dataRuntime, event, feedId, pageSize, publishSegment } = context
  if (event) {
    dataRuntime.adoptRequestToken({
      requestToken: event.requestToken,
      generation: event.generation,
      kind: 'latest',
    })
  }
  const resp = await getLatestMessages({ feedId, count: pageSize })

  if (resp.ok === false) {
    return { status: 'failed', message: resp.errorMessage }
  }

  if (
    context.isStale?.() ||
    (event && dataRuntime.getSegment().generation !== event.generation)
  ) {
    return { status: 'stale', message: 'ignored stale latest response' }
  }

  const input = {
    items: resp.messages.map(toDemoMessageDataItem),
    hasMoreBefore: resp.hasMoreBefore,
    hasMoreAfter: resp.hasMoreAfter,
    anchor: toRuntimeAnchor(resp.feedId, resp.anchor.messageId),
    anchorStatus: resp.anchorStatus,
  }
  const result = event
    ? dataRuntime.resetLatestFromRequest({
        ...input,
        requestToken: event.requestToken,
      })
    : {
        applied: true,
        segment: dataRuntime.resetLatest(input),
      }

  if (!result.applied) {
    return { status: 'stale', message: 'ignored stale latest response' }
  }

  publishSegment(dataRuntime)
  return {
    status: 'applied',
    message: `loaded ${resp.messages.length} latest messages`,
    total: resp.total,
  }
}

export async function applyAroundRequest(
  context: DemoRequestContext & {
    event: NeedMessagesAroundEvent
    align?: ResetAroundAlign
    offsetWithinMessage?: number
  },
): Promise<DemoRequestResult> {
  const { dataRuntime, event, pageSize, publishSegment } = context
  dataRuntime.adoptRequestToken({
    requestToken: event.requestToken,
    generation: event.generation,
    kind: 'around',
  })
  const targetMessageId = event.target.serverId ??
    event.target.stableId ??
    event.target.localId

  if (!targetMessageId) {
    return { status: 'failed', message: 'runtime requested anchor without id' }
  }

  const resp = await getMessagesAround({
    feedId: event.feedId,
    anchor: toDemoApiAnchor(event.target),
    before: Math.floor(pageSize / 2),
    after: Math.ceil(pageSize / 2),
  })

  if (resp.ok === false) {
    return { status: 'failed', message: resp.errorMessage }
  }

  if (context.isStale?.() || dataRuntime.getSegment().generation !== event.generation) {
    return { status: 'stale', message: 'ignored stale around response' }
  }

  const result = dataRuntime.resetAroundFromRequest({
    requestToken: event.requestToken,
    target: event.target,
    items: resp.messages.map(toDemoMessageDataItem),
    hasMoreBefore: resp.hasMoreBefore,
    hasMoreAfter: resp.hasMoreAfter,
    anchor: toRuntimeAnchor(resp.feedId, resp.anchor.messageId),
    anchorStatus: resp.anchorStatus,
    align: context.align,
    offsetWithinMessage: context.offsetWithinMessage,
  })

  if (!result.applied) {
    return { status: 'stale', message: 'ignored stale around response' }
  }

  publishSegment(dataRuntime)
  return {
    status: 'applied',
    message: `loaded around ${targetMessageId}`,
    total: resp.total,
  }
}

export async function applyEdgeRequest(
  context: DemoRequestContext & {
    event: NeedMoreBeforeEvent | NeedMoreAfterEvent
  },
): Promise<DemoRequestResult> {
  const { dataRuntime, event, pageSize, publishSegment, runtime } = context
  const edge = event.type === 'needMoreBefore' ? 'before' : 'after'
  const segmentBeforeFetch = dataRuntime.getSegment()
  const boundaryItem = edge === 'before'
    ? segmentBeforeFetch.items[0]
    : segmentBeforeFetch.items.at(-1)
  const boundaryMessage = boundaryItem?.message

  if (!boundaryMessage) {
    runtime.reportEdgeRequestFailure(edge, event.requestToken)
    return { status: 'failed', message: `missing ${edge} boundary message` }
  }

  dataRuntime.adoptRequestToken({
    requestToken: event.requestToken,
    generation: event.generation,
    kind: edge,
  })

  const resp = await getMessagesAround({
    feedId: event.feedId,
    anchor: {
      messageId: boundaryMessage.id,
      position: boundaryMessage.sequence,
    },
    before: edge === 'before' ? pageSize : 0,
    after: edge === 'after' ? pageSize : 0,
  })

  if (resp.ok === false) {
    runtime.reportEdgeRequestFailure(edge, event.requestToken)
    return { status: 'failed', message: resp.errorMessage }
  }

  if (context.isStale?.()) {
    runtime.reportEdgeRequestFailure(edge, event.requestToken)
    return { status: 'stale', message: `ignored stale ${edge} response` }
  }

  const currentSegment = dataRuntime.getSegment()
  const applyInput = {
    requestToken: event.requestToken,
    items: resp.messages.map(toDemoMessageDataItem),
    hasMoreBefore: edge === 'before'
      ? resp.hasMoreBefore
      : currentSegment.hasMoreBefore,
    hasMoreAfter: edge === 'after'
      ? resp.hasMoreAfter
      : currentSegment.hasMoreAfter,
    anchor: currentSegment.anchor,
    anchorStatus: currentSegment.anchorStatus,
  }
  const result = edge === 'before'
    ? dataRuntime.extendBefore(applyInput)
    : dataRuntime.extendAfter(applyInput)

  if (!result.applied) {
    runtime.reportEdgeRequestFailure(edge, event.requestToken)
    return { status: 'stale', message: `ignored stale ${edge} response` }
  }

  publishSegment(dataRuntime)
  return {
    status: 'applied',
    message: `loaded ${resp.messages.length} ${edge} messages`,
    total: resp.total,
  }
}

export function toRuntimeAnchor(
  feedId: string,
  messageId: string | undefined,
): MessageIdentityAnchor | undefined {
  if (!messageId) {
    return undefined
  }

  return {
    feedId,
    stableId: messageId,
    serverId: messageId,
  }
}

function toDemoApiAnchor(anchor: MessageIdentityAnchor): DemoApiAnchor {
  return {
    messageId: anchor.serverId ?? anchor.stableId ?? anchor.localId ?? '',
  }
}
