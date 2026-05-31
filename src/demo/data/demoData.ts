export type DemoViewportEffect =
  | 'none'
  | 'prepend'
  | 'append'
  | 'items-change'
  | 'auto-scroll-to-bottom'
  | 'reset'
  | 'remove-from-start'
  | 'item-location'
  | 'anchor-risk'

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
  '上滑和下滑来回切的时候，anchor 不能被连续 patch 带偏。',
  '这个消息模拟用户补充的一句上下文，长度不固定。',
  '客户端收到服务端回执后，只应该重绑身份，不应该重排已有 DOM。',
  '这里故意放一行比较平常的话，和长文本混在一起看滚动稳定性。',
]
const LONG_TEXT_LINES = [
  '这里模拟一个真实 IM 场景里突然出现的长篇大论。',
  '用户可能连续粘贴一段排查记录、会议纪要、错误堆栈或方案说明。',
  '消息高度会显著超过普通气泡，而且可能出现在 anchor 上方或下方。',
  '如果它刚好 prepend 进历史窗口，runtime 不能假设估算高度一定可靠。',
  '局部 patch、图片加载和引用块也可能在同一帧里改变 row 高度。',
  '这类消息会逼近真实聊天里最容易抖动的滚动路径。',
  'runtime 只能依赖 item identity、commit ack 后的同步测量和 ResizeObserver。',
  'index 不是滚动坐标，任何 DOM 复用错误都会在这种场景里被放大。',
  '尾部 arrival、历史分页和 jump settle 都需要保持同一套锚点语义。',
  '这最后一行用来把多行文本扩到更接近真实用户输入的高度。',
]
const MEDIA_CAPTION_LINES = [
  '发了一张截图，加载完成后高度可能变化。',
  '附件说明里也可能带多行文字，不能只按一行 caption 估算。',
  '真实 IM 里图片、视频和相册经常混在连续消息中出现。',
  '媒体比例差异会让 ResizeObserver 的时机更接近生产环境。',
  '这一行用于扩大媒体消息自身文本区的高度。',
  '用户可能在图片下面补充操作步骤、复现路径和额外说明。',
  '连续媒体消息会放大边缘分页时的锚点误差。',
  '媒体还可能夹着引用、回执和反应状态一起更新。',
  '长 caption 可以模拟设计评审或问题反馈中的真实输入。',
  '这行继续把媒体消息推到更高的滚动压力场景。',
]
const MIN_TEXT_LINE_COUNT = 1
const MAX_TEXT_LINE_COUNT = 10
const feedCursors = new Map<string, { oldest: number; newest: number }>()

export function createDemoMessages(
  count: number,
  feedId = DEFAULT_FEED_ID,
  startSequence = 1,
): DemoMessage[] {
  const messages = Array.from({ length: count }, (_, index) =>
    createDemoMessage(feedId, startSequence + index),
  )

  syncFeedCursor(feedId, messages)
  return messages
}

export function createNewestMessage(
  options?: DemoMessageCreateOptions,
): DemoMessage
export function createNewestMessage(
  feedId: string,
  sequence: number,
  body?: string,
): DemoMessage
export function createNewestMessage(
  first: string | DemoMessageCreateOptions = {},
  sequence?: number,
  body?: string,
): DemoMessage {
  if (typeof first === 'string') {
    const message = createOutgoingMessage(body ?? 'New message', {
      feedId: first,
      sequence,
    })
    syncFeedCursor(first, [message])
    return message
  }

  const feedId = first.feedId ?? DEFAULT_FEED_ID
  const nextSequence = first.sequence ?? getFallbackNextSequence(feedId)
  const message = maybeAttachRandomQuote(
    createDemoMessage(feedId, nextSequence),
    first.quoteCandidates ?? [],
    first.random,
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
      id: createDemoMessageId(feedId, sequence),
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

export function createOlderMessages(
  count: number,
  options: DemoMessageCreateOptions = {},
): DemoMessage[] {
  const feedId = options.feedId ?? DEFAULT_FEED_ID
  const beforeSequence =
    options.beforeSequence ?? getFallbackPreviousBoundary(feedId)
  const startSequence = beforeSequence - count
  const messages = Array.from({ length: count }, (_, index) =>
    createDemoMessage(feedId, startSequence + index),
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

export function normalizeDemoMessages(
  feedId: string,
  messages: DemoMessage[],
): DemoMessage[] {
  const normalized = messages
    .map((message, index) => normalizeDemoMessage(feedId, message, index))
    .sort((left, right) => left.sequence - right.sequence)

  syncFeedCursor(feedId, normalized)
  return normalized
}

export function createDemoMessageId(feedId: string, sequence: number): string {
  return `${feedId}-${String(sequence).padStart(4, '0')}`
}

export function estimateDemoMessageHeight(message: DemoMessage): number {
  const lineEstimate = Math.max(
    1,
    message.body.split('\n').length,
    Math.ceil(message.body.length / 48),
  )
  const textHeight = Math.max(
    message.kind === 'longText' ? 230 : 76,
    36 + lineEstimate * (message.kind === 'longText' ? 24 : 22),
  )
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

function normalizeDemoMessage(
  feedId: string,
  message: DemoMessage,
  index: number,
): DemoMessage {
  const sequence = Number.isFinite(message.sequence)
    ? message.sequence
    : index + 1
  const id = message.id || createDemoMessageId(feedId, sequence)
  const base = createDemoMessage(feedId, sequence)
  const body = typeof message.body === 'string' && message.body.length > 0
    ? message.body
    : base.body
  const kind = message.kind ?? (body.length > 180 ? 'longText' : base.kind)

  return {
    ...base,
    ...message,
    id,
    feedId: message.feedId || feedId,
    sequence,
    body,
    kind,
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
    media: message.media ?? createMedia(kind, Math.abs(sequence)),
    quote: normalizeQuote(message.quote),
  }
}

function createDemoMessage(feedId: string, sequence: number): DemoMessage {
  const feedOffset = Math.abs(hashCode(feedId)) % 23
  const absolute = Math.abs(sequence) + feedOffset
  const kind = pickKind(absolute)
  const id = createDemoMessageId(feedId, sequence)

  return {
    id,
    feedId,
    sequence,
    author: AUTHORS[absolute % AUTHORS.length] ?? 'Lin',
    body: createBody(kind, id),
    tone: absolute % 11 === 0 ? 'system' : absolute % 3 === 0 ? 'self' : 'peer',
    kind,
    expanded: absolute % 8 === 0,
    reactions: [],
    media: createMedia(kind, absolute),
  }
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
    return createMultilineBody({
      id,
      lines: LONG_TEXT_LINES,
      lineCount: pickLineCount(id, 6, MAX_TEXT_LINE_COUNT),
    })
  }

  if (kind === 'image') {
    return createMultilineBody({
      id,
      lines: MEDIA_CAPTION_LINES,
      lineCount: pickLineCount(id, 1, 10),
    })
  }

  if (kind === 'video') {
    return createMultilineBody({
      id,
      lines: [
        '发了一个视频，封面和控制条会让 row 高度更复杂。',
        ...MEDIA_CAPTION_LINES,
      ],
      lineCount: pickLineCount(id, 1, 10),
    })
  }

  if (kind === 'album') {
    return createMultilineBody({
      id,
      lines: [
        '发了一组图片，真实 IM 中这类消息最容易暴露 spacer 估算问题。',
        ...MEDIA_CAPTION_LINES,
      ],
      lineCount: pickLineCount(id, 2, 10),
    })
  }

  return createMultilineBody({
    id,
    lines: SHORT_TEXTS,
    lineCount: pickLineCount(id, MIN_TEXT_LINE_COUNT, MAX_TEXT_LINE_COUNT),
  })
}

function createMedia(kind: DemoMessageKind, seed: number): DemoMessage['media'] {
  if (kind === 'text' || kind === 'longText') {
    return undefined
  }

  if (kind === 'video') {
    return {
      width: 360,
      height: 200 + (seed % 10) * 58,
      label: 'Video preview',
    }
  }

  if (kind === 'album') {
    return {
      width: 360,
      height: 240 + (seed % 12) * 56,
      label: 'Image album',
    }
  }

  return {
    width: 360,
    height: 180 + (seed % 12) * 52,
    label: 'Image attachment',
  }
}

function createMultilineBody(input: {
  id: string
  lines: string[]
  lineCount: number
}): string {
  return Array.from({ length: input.lineCount }, (_, index) => {
    const line = input.lines[
      (Math.abs(hashCode(`${input.id}:${index}`)) + index) % input.lines.length
    ] ?? input.lines[0] ?? ''

    return index === 0 ? `${input.id} ${line}` : line
  }).join('\n')
}

function pickLineCount(id: string, min: number, max: number): number {
  const lower = Math.max(1, Math.min(min, max))
  const upper = Math.max(lower, max)
  return lower + (Math.abs(hashCode(`${id}:line-count`)) % (upper - lower + 1))
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
