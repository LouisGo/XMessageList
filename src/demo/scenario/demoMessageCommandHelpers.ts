import {
  createOutgoingMessage,
  type DemoMessage,
} from '../data/demoData'
import {
  readDemoFeedMessages,
  replaceDemoFeedMessages,
} from '../data/demoMessageApi'

export function updatePersistedMessage(
  feedId: string,
  messageId: string,
  mutate: (message: DemoMessage) => DemoMessage | undefined,
): { message: DemoMessage; messages: DemoMessage[] } | null {
  const feedMessages = readDemoFeedMessages(feedId)
  let nextMessage: DemoMessage | null = null
  const nextMessages = feedMessages.map((message) => {
    if (message.id !== messageId) {
      return message
    }

    const updated = mutate(message)

    if (!updated) {
      return message
    }

    nextMessage = updated
    return updated
  })

  if (!nextMessage) {
    return null
  }

  return {
    message: nextMessage,
    messages: replaceDemoFeedMessages(feedId, nextMessages),
  }
}

export function createRetriedOutgoingMessage(input: {
  feedId: string
  target: DemoMessage
  sequence: number
}): DemoMessage {
  const { feedId, target, sequence } = input

  return {
    ...createOutgoingMessage(target.body, {
      feedId,
      sequence,
    }),
    kind: target.kind,
    expanded: target.expanded,
    media: target.media,
    quote: target.quote,
    sendStatus: 'sent',
    sendAttempt: target.sendAttempt,
    sendError: undefined,
  }
}

export function publishRetriedOutgoingMessage(input: {
  feedId: string
  targetId: string
  retryMessage: DemoMessage
  persistedMessages: DemoMessage[]
  shouldRebuildLatest: boolean
  stageOutgoingMessage: (
    feedId: string,
    message: DemoMessage,
    persistedMessages: DemoMessage[],
    shouldRebuildLatest: boolean,
    reason: 'send' | 'retry',
    options?: {
      retireKeys?: string[]
    },
  ) => void
}): void {
  input.stageOutgoingMessage(
    input.feedId,
    input.retryMessage,
    input.persistedMessages,
    input.shouldRebuildLatest,
    'retry',
    {
      retireKeys: [input.targetId],
    },
  )
}
