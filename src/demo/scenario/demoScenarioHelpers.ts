import type { Dispatch, SetStateAction } from 'react'
import {
  createNewestMessage,
  getNextMessageSequence,
  type DemoMessage,
} from '../data/demoData'
import type { DemoHighlightState } from './demoScenarioTypes'

const JUMP_HIGHLIGHT_DURATION_MS = 1_400
const LONG_BURST_EXPANDED_INDEX = 1
const LONG_BURST_LINE_COUNT = 10

export function consumeDeferredEdgeResponseDelay(
  ref: { current: number },
): number {
  const delayMs = ref.current
  ref.current = 0
  return delayMs
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function getMockDelayMs(
  baseMs: number,
  random: () => number = Math.random,
): number {
  const normalizedBase = Math.max(0, baseMs)
  const factor = 0.5 + random()

  return Math.round(normalizedBase * factor)
}

export function waitMockDelay(
  baseMs: number,
  random?: () => number,
): Promise<void> {
  return wait(getMockDelayMs(baseMs, random))
}

export function resolveScenarioTotalMessages(scenarioId: string): number {
  if (scenarioId === 'underflow.dual-edge-arbitration') {
    return 18
  }

  return 80
}

export function usesAroundBootstrap(scenarioId: string): boolean {
  return scenarioId === 'paging.after-native-thumb-rebound' ||
    scenarioId === 'underflow.dual-edge-arbitration' ||
    scenarioId === 'destination.jump-in-segment' ||
    scenarioId === 'follow-bottom.partial-segment' ||
    scenarioId === 'scrollbar.drag-edge-after'
}

export function createMockNewestMessages(input: {
  feedId: string
  count: number
  existingMessages: DemoMessage[]
  startSequence?: number
}): DemoMessage[] {
  const firstSequence = input.startSequence ??
    getNextMessageSequence(input.existingMessages)
  let quoteCandidates = [...input.existingMessages]

  return Array.from({ length: input.count }, (_, index) => {
    const message = createNewestMessage({
      feedId: input.feedId,
      sequence: firstSequence + index,
      quoteCandidates,
    })
    quoteCandidates = [...quoteCandidates, message]
    return message
  })
}

export function applyLongBurstShape(messages: DemoMessage[]): DemoMessage[] {
  return messages.map((message, index) =>
    index === LONG_BURST_EXPANDED_INDEX
      ? {
          ...message,
          kind: 'longText',
          body: expandBodyToLineCount(message.body, LONG_BURST_LINE_COUNT),
          expanded: true,
        }
      : message,
  )
}

export function resolveLoadedBounds(
  feedMessages: DemoMessage[],
  messages: DemoMessage[],
): {
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
} {
  if (messages.length === 0) {
    return {
      hasMoreBefore: feedMessages.length > 0,
      hasMoreAfter: false,
    }
  }

  const firstIndex = feedMessages.findIndex((message) =>
    message.id === messages[0]?.id
  )
  const lastIndex = feedMessages.findIndex((message) =>
    message.id === messages.at(-1)?.id
  )

  return {
    hasMoreBefore: firstIndex > 0,
    hasMoreAfter: lastIndex >= 0 && lastIndex < feedMessages.length - 1,
  }
}

export function resolveChangedMessageKeys(
  before: DemoMessage[],
  after: DemoMessage[],
): string[] {
  const beforeById = new Map(before.map((message) => [message.id, message]))
  const afterById = new Map(after.map((message) => [message.id, message]))
  const changed = new Set<string>()

  for (const message of before) {
    const next = afterById.get(message.id)

    if (!next || serializeComparableMessage(message) !== serializeComparableMessage(next)) {
      changed.add(message.id)
    }
  }

  for (const message of after) {
    if (!beforeById.has(message.id)) {
      changed.add(message.id)
    }
  }

  return [...changed]
}

export function highlightMessage(
  messageId: string,
  options: DemoHighlightState,
): void {
  if (options.highlightTimerRef.current !== null) {
    window.clearTimeout(options.highlightTimerRef.current)
  }

  options.setHighlightedMessageId(messageId)
  options.setHighlightToken((token) => token + 1)
  options.highlightTimerRef.current = window.setTimeout(() => {
    options.setHighlightedMessageId(null)
    options.highlightTimerRef.current = null
  }, JUMP_HIGHLIGHT_DURATION_MS)
}

export function clearHighlightTimer(
  highlightTimerRef: { current: number | null },
  setHighlightedMessageId?: Dispatch<SetStateAction<string | null>>,
): void {
  if (highlightTimerRef.current === null) {
    return
  }

  window.clearTimeout(highlightTimerRef.current)
  highlightTimerRef.current = null
  setHighlightedMessageId?.(null)
}

function serializeComparableMessage(message: DemoMessage): string {
  return JSON.stringify({
    body: message.body,
    kind: message.kind,
    expanded: message.expanded,
    editedAt: message.editedAt ?? '',
    reactions: message.reactions,
    sendStatus: message.sendStatus ?? '',
    sendAttempt: message.sendAttempt ?? 0,
    sendError: message.sendError ?? '',
    media: message.media ?? null,
    quote: message.quote ?? null,
  })
}

function expandBodyToLineCount(body: string, lineCount: number): string {
  const sourceLines = body.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const lines = sourceLines.length > 0 ? sourceLines : [body]

  return Array.from({ length: lineCount }, (_, index) =>
    lines[index % lines.length] ?? '',
  ).join('\n')
}
