import type { MessageDataItem } from '../runtime'

export type DemoMessage = {
  id: string
  feedId: string
  sequence: number
  author: string
  body: string
  tone: 'self' | 'peer' | 'system'
}

const AUTHORS = ['Lin', 'Rae', 'Mo', 'Kai', 'Nora', 'Sam']
const TEXTS = [
  'Loaded segment 里的真实 DOM 高度就是 scrollHeight。',
  '这条消息用于验证 MessageList 命名和 projection skeleton。',
  'Runtime owns scroll / measurement / transaction / anchor correction.',
  'React adapter 只做 projection、refs 和 commit ack。',
]

export function createDemoMessages(
  count: number,
  feedId = 'feed-runtime',
  startSequence = 1,
): DemoMessage[] {
  return Array.from({ length: count }, (_, index) =>
    createDemoMessage(feedId, startSequence + index),
  )
}

export function createNewestMessage(
  feedId: string,
  sequence: number,
  body = 'New message',
): DemoMessage {
  return {
    id: createDemoMessageId(feedId, sequence),
    feedId,
    sequence,
    author: 'You',
    body,
    tone: 'self',
  }
}

export function toDemoMessageDataItem(
  message: DemoMessage,
): MessageDataItem<DemoMessage> {
  return {
    key: message.id,
    rowKind: 'message',
    identity: {
      feedId: message.feedId,
      stableId: message.id,
      serverId: message.id,
      version: 1,
    },
    renderVersion: 1,
    message,
  }
}

export function normalizeDemoMessages(
  feedId: string,
  messages: DemoMessage[],
): DemoMessage[] {
  return messages
    .map((message, index) => ({
      ...message,
      feedId,
      sequence: Number.isFinite(message.sequence)
        ? message.sequence
        : index + 1,
      id: message.id || createDemoMessageId(feedId, index + 1),
    }))
    .sort((left, right) => left.sequence - right.sequence)
}

export function createDemoMessageId(feedId: string, sequence: number): string {
  return `${feedId}-${String(sequence).padStart(4, '0')}`
}

function createDemoMessage(feedId: string, sequence: number): DemoMessage {
  return {
    id: createDemoMessageId(feedId, sequence),
    feedId,
    sequence,
    author: AUTHORS[sequence % AUTHORS.length] ?? 'Lin',
    body: TEXTS[sequence % TEXTS.length] ?? TEXTS[0],
    tone: sequence % 5 === 0 ? 'self' : 'peer',
  }
}
