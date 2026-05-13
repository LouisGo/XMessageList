import type {
  CommittedMessageDataItem,
  MessageDataSnapshot,
  ViewportEffect,
} from '../runtime'

export type DemoMessageKind = 'text' | 'longText' | 'image' | 'video' | 'album'

export type DemoMessage = {
  id: string
  author: string
  body: string
  tone: 'self' | 'peer' | 'system'
  kind: DemoMessageKind
  expanded: boolean
  media?: {
    width: number
    height: number
    label: string
  }
}

let newestMessageNumber = 1
let oldestMessageNumber = 0

const AUTHORS = ['Lin', 'Rae', 'Mo', 'Kai', 'Nora', 'Sam']

const SHORT_TEXTS = [
  '刚刚看了日志，问题大概率在 prepend correction。',
  '我这边发一条短消息，确认 bottom lock 有没有被误解锁。',
  '图片 decode 后高度会变，这个场景需要重点压。',
  '这条消息用于模拟普通聊天里的快速往返。',
]

const LONG_TEXT =
  '这里模拟一个真实 IM 场景里突然出现的长篇大论：用户可能连续粘贴一段排查记录、会议纪要、错误堆栈、方案说明，甚至把多个上下文合并到一条消息里。消息高度会显著超过普通气泡，且它可能出现在 anchor 上方、下方或刚刚 prepend 进来的历史窗口中。runtime 不能假设消息高度稳定，也不能把 index 当成滚动坐标；它只能依赖 item identity、commit ack 后的同步测量和后续 ResizeObserver dirty batching 来维持视口稳定。'

export function createDemoMessages(count: number): DemoMessage[] {
  return Array.from({ length: count }, () => createNewestMessage())
}

export function createNewestMessage(): DemoMessage {
  const number = newestMessageNumber
  newestMessageNumber += 1
  oldestMessageNumber = Math.min(oldestMessageNumber, number)
  return createMessage(number, 'new')
}

export function createOutgoingMessage(body: string): DemoMessage {
  const number = newestMessageNumber
  newestMessageNumber += 1

  return {
    id: `m-${number}`,
    author: 'You',
    body,
    tone: 'self',
    kind: body.length > 180 ? 'longText' : 'text',
    expanded: false,
  }
}

export function createOlderMessages(count: number): DemoMessage[] {
  const messages: DemoMessage[] = []

  for (let index = 0; index < count; index += 1) {
    oldestMessageNumber -= 1
    messages.push(createMessage(oldestMessageNumber, 'old'))
  }

  return messages.reverse()
}

function createMessage(number: number, direction: 'new' | 'old'): DemoMessage {
  const absolute = Math.abs(number)
  const kind = pickKind(absolute)
  const author = AUTHORS[absolute % AUTHORS.length] ?? 'Lin'
  const tone = absolute % 11 === 0 ? 'system' : absolute % 3 === 0 ? 'self' : 'peer'
  const id = direction === 'old' ? `h-${absolute}` : `m-${number}`

  return {
    id,
    author,
    body: createBody(kind, id),
    tone,
    kind,
    expanded: absolute % 8 === 0,
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
  return textHeight + mediaHeight + expandedHeight
}

export function toCommittedItem(
  message: DemoMessage,
): CommittedMessageDataItem<DemoMessage> {
  return {
    kind: 'committed',
    key: { kind: 'committed', messageId: message.id },
    message,
    version: message.expanded ? 2 : 1,
    contentVersion: message.expanded ? 2 : 1,
    estimatedHeight: estimateDemoMessageHeight(message),
  }
}

export function createDemoSnapshot(input: {
  messages: DemoMessage[]
  revision: number
  effect: ViewportEffect
  kind?: MessageDataSnapshot['change']['kind']
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
}): MessageDataSnapshot<DemoMessage> {
  return {
    feedId: 'demo-feed',
    generation: 1,
    revision: input.revision,
    items: input.messages.map(toCommittedItem),
    anchor: input.messages.at(-1)
      ? { messageId: input.messages.at(-1)?.id ?? '' }
      : undefined,
    anchorStatus: 'normal',
    hasMoreBefore: input.hasMoreBefore ?? true,
    hasMoreAfter: input.hasMoreAfter ?? false,
    change: {
      kind: input.kind ?? 'patch',
      viewportEffect: input.effect,
    },
  }
}

function hashCode(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return hash
}
