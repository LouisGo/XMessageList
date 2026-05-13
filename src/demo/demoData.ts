import type {
  CommittedMessageDataItem,
  MessageDataSnapshot,
  ViewportEffect,
} from '../runtime'

export type DemoMessage = {
  id: string
  author: string
  text: string
  tone: 'self' | 'peer' | 'system'
  expanded: boolean
}

let nextMessageNumber = 1

const AUTHORS = ['Lin', 'Rae', 'Mo', 'Kai']

const TEXTS = [
  '这个 runtime 只把消息 row 放回正常文档流，滚动修正交给 viewport transaction。',
  'prepend 不是数组 unshift，它必须保留旧 anchor 并在 commit 后做 rect correction。',
  'ResizeObserver 只报告高度 dirty，真正的 scrollTop 写入必须合并到 rAF。',
  'bottom lock 是独立状态，append 不应该抢走正在向上阅读的用户。',
  'React adapter 只负责 projection snapshot、DOM ref registry 和 commit ack。',
]

export function createDemoMessages(count: number): DemoMessage[] {
  return Array.from({ length: count }, () => createDemoMessage())
}

export function createDemoMessage(): DemoMessage {
  const number = nextMessageNumber
  nextMessageNumber += 1

  return {
    id: `m-${number}`,
    author: AUTHORS[number % AUTHORS.length] ?? 'Lin',
    text: TEXTS[number % TEXTS.length] ?? TEXTS[0],
    tone: number % 7 === 0 ? 'system' : number % 3 === 0 ? 'self' : 'peer',
    expanded: number % 9 === 0,
  }
}

export function createOlderMessages(count: number): DemoMessage[] {
  const messages = Array.from({ length: count }, () => createDemoMessage())
  return messages.map((message) => ({
    ...message,
    text: `历史消息 ${message.id}。${message.text}`,
  }))
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
    estimatedHeight: message.expanded ? 132 : 76,
  }
}

export function createDemoSnapshot(input: {
  messages: DemoMessage[]
  revision: number
  effect: ViewportEffect
  kind?: MessageDataSnapshot['change']['kind']
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
    hasMoreBefore: true,
    hasMoreAfter: false,
    change: {
      kind: input.kind ?? 'patch',
      viewportEffect: input.effect,
    },
  }
}
