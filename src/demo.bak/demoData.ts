import type {
  CommittedMessageDataItem,
  MessageIdentityAnchor,
  MessageDataSnapshot,
  ViewportEffect,
} from '../runtime.deprecated'

export type DemoMessageKind = 'text' | 'longText' | 'image' | 'video' | 'album'

export type DemoMessage = {
  id: string
  feedId: string
  sequence: number
  author: string
  body: string
  tone: 'self' | 'peer' | 'system'
  kind: DemoMessageKind
  expanded: boolean
  editedAt?: string
  reactions: string[]
  media?: {
    width: number
    height: number
    label: string
  }
  quote?: {
    messageId: string
    position: number
    author: string
    bodyPreview: string
  }
}

export type DemoMessageCreateOptions = {
  feedId?: string
  sequence?: number
  beforeSequence?: number
  quoteCandidates?: DemoMessage[]
  random?: () => number
}

const DEFAULT_FEED_ID = 'feed-runtime'

const AUTHORS = ['Lin', 'Rae', 'Mo', 'Kai', 'Nora', 'Sam']

const SHORT_TEXTS = [
  '刚刚看了日志，问题大概率在 prepend correction。',
  '我这边发一条短消息，确认 bottom lock 有没有被误解锁。',
  '图片 decode 后高度会变，这个场景需要重点压。',
  '这条消息用于模拟普通聊天里的快速往返。',
]

const LONG_TEXT =
  '这里模拟一个真实 IM 场景里突然出现的长篇大论：用户可能连续粘贴一段排查记录、会议纪要、错误堆栈、方案说明，甚至把多个上下文合并到一条消息里。消息高度会显著超过普通气泡，且它可能出现在 anchor 上方、下方或刚刚 prepend 进来的历史窗口中。runtime 不能假设消息高度稳定，也不能把 index 当成滚动坐标；它只能依赖 item identity、commit ack 后的同步测量和后续 ResizeObserver dirty batching 来维持视口稳定。'

const feedCursors = new Map<string, { oldest: number; newest: number }>()

/**
 * Demo 消息生成器以 feedId + sequence 作为稳定身份来源。
 * 这样切换会话后即使消息数量相同，runtime 也不会复用另一条会话的 DOM 身份。
 */
export function createDemoMessages(
  count: number,
  feedId = DEFAULT_FEED_ID,
  startSequence = 1,
): DemoMessage[] {
  const messages = Array.from({ length: count }, (_, index) =>
    createMessage(feedId, startSequence + index),
  )

  syncFeedCursor(feedId, messages)
  return messages
}

export function createNewestMessage(
  options: DemoMessageCreateOptions = {},
): DemoMessage {
  const feedId = options.feedId ?? DEFAULT_FEED_ID
  const sequence = options.sequence ?? getFallbackNextSequence(feedId)
  const message = maybeAttachRandomQuote(
    createMessage(feedId, sequence),
    options.quoteCandidates ?? [],
    options.random,
  )

  syncFeedCursor(feedId, [message])
  return message
}

export function createOutgoingMessage(
  body: string,
  options: DemoMessageCreateOptions = {},
): DemoMessage {
  const feedId = options.feedId ?? DEFAULT_FEED_ID
  const sequence = options.sequence ?? getFallbackNextSequence(feedId)
  const message = maybeAttachRandomQuote(
    {
      id: createMessageId(feedId, sequence),
      feedId,
      sequence,
      author: 'You',
      body,
      tone: 'self',
      kind: body.length > 180 ? 'longText' : 'text',
      expanded: false,
      reactions: [],
    },
    options.quoteCandidates ?? [],
    options.random,
  )

  syncFeedCursor(feedId, [message])
  return message
}

export function maybeAttachRandomQuote(
  message: DemoMessage,
  candidates: DemoMessage[],
  random: () => number = Math.random,
): DemoMessage {
  const quoteCandidates = candidates.filter(
    (candidate) =>
      candidate.feedId === message.feedId &&
      candidate.sequence < message.sequence,
  )

  if (quoteCandidates.length === 0 || random() >= 0.6) {
    return message
  }

  const quoted =
    quoteCandidates[
      Math.floor(random() * quoteCandidates.length) % quoteCandidates.length
    ]

  if (!quoted) {
    return message
  }

  return {
    ...message,
    quote: {
      messageId: quoted.id,
      position: quoted.sequence,
      author: quoted.author,
      bodyPreview: createQuotePreview(quoted.body),
    },
  }
}

/**
 * prepend 使用当前最小 sequence 之前的连续区间，模拟服务端返回的一页历史快照。
 * 生成结果按时间升序返回，保证正常文档流中的 DOM 顺序不需要二次修正。
 */
export function createOlderMessages(
  count: number,
  options: DemoMessageCreateOptions = {},
): DemoMessage[] {
  const feedId = options.feedId ?? DEFAULT_FEED_ID
  const beforeSequence =
    options.beforeSequence ?? getFallbackPreviousBoundary(feedId)
  const startSequence = beforeSequence - count
  const messages = Array.from({ length: count }, (_, index) =>
    createMessage(feedId, startSequence + index),
  )

  syncFeedCursor(feedId, messages)
  return messages
}

export function getNextMessageSequence(messages: DemoMessage[]): number {
  return messages.reduce(
    (next, message) => Math.max(next, message.sequence + 1),
    1,
  )
}

export function getFirstMessageSequence(messages: DemoMessage[]): number {
  return messages.reduce(
    (first, message) => Math.min(first, message.sequence),
    messages[0]?.sequence ?? 1,
  )
}

/**
 * 旧的本地持久化文件可能缺少 feedId / sequence。
 * 这里只补齐 demo 运行需要的最小字段，不尝试做服务端数据迁移。
 */
export function normalizeDemoMessages(
  feedId: string,
  messages: DemoMessage[],
): DemoMessage[] {
  const normalized = messages.map((message, index) => {
    const sequence =
      typeof message.sequence === 'number' ? message.sequence : index + 1

    return {
      ...message,
      id: message.id || createMessageId(feedId, sequence),
      feedId: message.feedId || feedId,
      sequence,
      expanded: Boolean(message.expanded),
      reactions: Array.isArray(message.reactions)
        ? message.reactions.filter((reaction): reaction is string =>
            typeof reaction === 'string' && reaction.length > 0,
          )
        : [],
      editedAt:
        typeof message.editedAt === 'string' && message.editedAt.length > 0
          ? message.editedAt
          : undefined,
      quote: normalizeQuote(message.quote),
    }
  })

  syncFeedCursor(feedId, normalized)
  return normalized
}

function createMessage(feedId: string, sequence: number): DemoMessage {
  const feedOffset = Math.abs(hashCode(feedId)) % 23
  const absolute = Math.abs(sequence) + feedOffset
  const kind = pickKind(absolute)
  const author = AUTHORS[absolute % AUTHORS.length] ?? 'Lin'
  const tone = absolute % 11 === 0 ? 'system' : absolute % 3 === 0 ? 'self' : 'peer'
  const id = createMessageId(feedId, sequence)

  return {
    id,
    feedId,
    sequence,
    author,
    body: createBody(kind, id),
    tone,
    kind,
    expanded: absolute % 8 === 0,
    reactions: [],
    media: createMedia(kind, absolute),
  }
}

function createMessageId(feedId: string, sequence: number): string {
  const channel = sequence > 0 ? 'm' : 'h'
  return `${feedId}-${channel}-${Math.abs(sequence)}`
}

function pickKind(number: number): DemoMessageKind {
  if (number % 17 === 0) return 'album'
  if (number % 13 === 0) return 'video'
  if (number % 7 === 0) return 'image'
  if (number % 5 === 0) return 'longText'
  return 'text'
}

function createBody(kind: DemoMessageKind, id: string): string {
  if (kind === 'longText') {
    return `${id} ${LONG_TEXT}`
  }

  if (kind === 'image') {
    return '发了一张截图，加载完成后高度可能变化。'
  }

  if (kind === 'video') {
    return '发了一个视频，封面和控制条会让 row 高度更复杂。'
  }

  if (kind === 'album') {
    return '发了一组图片，真实 IM 中这类消息最容易暴露 spacer 估算问题。'
  }

  return `${id} ${SHORT_TEXTS[Math.abs(hashCode(id)) % SHORT_TEXTS.length]}`
}

function createMedia(kind: DemoMessageKind, seed: number): DemoMessage['media'] {
  if (kind === 'text' || kind === 'longText') {
    return undefined
  }

  if (kind === 'video') {
    return {
      width: 360,
      height: 202 + (seed % 3) * 28,
      label: 'Video preview',
    }
  }

  if (kind === 'album') {
    return {
      width: 360,
      height: 248 + (seed % 2) * 44,
      label: 'Image album',
    }
  }

  return {
    width: 360,
    height: 180 + (seed % 4) * 42,
    label: 'Image attachment',
  }
}

export function estimateDemoMessageHeight(message: DemoMessage): number {
  const textHeight = message.kind === 'longText' ? 230 : 76
  const mediaHeight = message.media ? message.media.height + 28 : 0
  const expandedHeight = message.expanded ? 78 : 0
  const quoteHeight = message.quote ? 58 : 0
  const reactionRows =
    message.reactions.length > 0
      ? Math.ceil(message.reactions.length / 6)
      : 0
  const reactionHeight = reactionRows * 32
  return textHeight + quoteHeight + mediaHeight + expandedHeight + reactionHeight
}

export function toCommittedItem(
  message: DemoMessage,
): CommittedMessageDataItem<DemoMessage> {
  const contentVersion = getDemoMessageContentVersion(message)
  return {
    kind: 'committed',
    key: { kind: 'committed', messageId: message.id },
    message,
    version: contentVersion,
    contentVersion,
    estimatedHeight: estimateDemoMessageHeight(message),
  }
}

function getDemoMessageContentVersion(message: DemoMessage): number {
  return (
    Math.abs(
      hashCode(
        JSON.stringify({
          body: message.body,
          kind: message.kind,
          expanded: message.expanded,
          editedAt: message.editedAt ?? '',
          reactions: message.reactions,
          media: message.media ?? null,
          quote: message.quote ?? null,
        }),
      ),
    ) + 1
  )
}

function normalizeQuote(messageQuote: DemoMessage['quote']): DemoMessage['quote'] {
  if (
    !messageQuote ||
    typeof messageQuote.messageId !== 'string' ||
    messageQuote.messageId.length === 0 ||
    !Number.isFinite(messageQuote.position) ||
    typeof messageQuote.author !== 'string' ||
    typeof messageQuote.bodyPreview !== 'string'
  ) {
    return undefined
  }

  return {
    messageId: messageQuote.messageId,
    position: messageQuote.position,
    author: messageQuote.author,
    bodyPreview: messageQuote.bodyPreview,
  }
}

function createQuotePreview(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim()
  return compact.length > 96 ? `${compact.slice(0, 96)}...` : compact
}

export function createDemoSnapshot(input: {
  feedId: string
  generation: number
  messages: DemoMessage[]
  revision: number
  effect: ViewportEffect
  kind?: MessageDataSnapshot['change']['kind']
  anchor?: MessageIdentityAnchor
  anchorStatus?: MessageDataSnapshot['anchorStatus']
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
}): MessageDataSnapshot<DemoMessage> {
  return {
    feedId: input.feedId,
    generation: input.generation,
    revision: input.revision,
    items: input.messages.map(toCommittedItem),
    anchor:
      input.anchor ??
      (input.messages.at(-1)
        ? { messageId: input.messages.at(-1)?.id ?? '' }
        : undefined),
    anchorStatus: input.anchorStatus ?? 'normal',
    hasMoreBefore: input.hasMoreBefore ?? input.messages.length > 0,
    hasMoreAfter: input.hasMoreAfter ?? false,
    change: {
      kind: input.kind ?? 'patch',
      viewportEffect: input.effect,
    },
  }
}

function syncFeedCursor(feedId: string, messages: DemoMessage[]): void {
  if (messages.length === 0) {
    return
  }

  const current = feedCursors.get(feedId)
  const oldest = Math.min(
    current?.oldest ?? messages[0]?.sequence ?? 1,
    ...messages.map((message) => message.sequence),
  )
  const newest = Math.max(
    current?.newest ?? messages[0]?.sequence ?? 1,
    ...messages.map((message) => message.sequence),
  )

  feedCursors.set(feedId, { oldest, newest })
}

function getFallbackNextSequence(feedId: string): number {
  const cursor = feedCursors.get(feedId)
  return cursor ? cursor.newest + 1 : 1
}

function getFallbackPreviousBoundary(feedId: string): number {
  const cursor = feedCursors.get(feedId)
  return cursor ? cursor.oldest : 1
}

function hashCode(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return hash
}
