import type {
  DemoMessage,
  DemoViewportEffect,
} from './demoData'

export type AdvancedMockSnapshotKind = 'append' | 'patch' | 'delete' | 'reset'
export type RandomSource = () => number
export type StormCounterName =
  | 'append'
  | 'lateAppend'
  | 'reaction'
  | 'edit'
  | 'delete'

export type StormDeleteMode = 'single' | 'contiguous' | 'jump'

export type StormTickDetails = {
  tick: number
  append: number
  reaction: number
  edit: number
  delete: number
  deleteEvents: number
  deleteModes: Record<StormDeleteMode, number>
  buffered: number
}

const STORM_DELETE_HOT_WINDOW_SIZE = 100

export function pickStormEventCount(random: RandomSource): number {
  const roll = random()

  if (roll < 0.72) {
    return 1
  }

  if (roll < 0.94) {
    return 2
  }

  return 3
}

export function pickStormEventKind(
  random: RandomSource,
): 'append' | 'reaction' | 'edit' | 'delete' {
  const roll = random()

  if (roll < 0.55) {
    return 'append'
  }

  if (roll < 0.8) {
    return 'reaction'
  }

  if (roll < 0.96) {
    return 'edit'
  }

  return 'delete'
}

export function createTickDetails(tick: number): StormTickDetails {
  return {
    tick,
    append: 0,
    reaction: 0,
    edit: 0,
    delete: 0,
    deleteEvents: 0,
    deleteModes: {
      single: 0,
      contiguous: 0,
      jump: 0,
    },
    buffered: 0,
  }
}

export function formatStormEventText(details: StormTickDetails): string {
  const parts = [
    details.append > 0 ? `${details.append} append` : '',
    details.reaction > 0 ? `${details.reaction} reaction` : '',
    details.edit > 0 ? `${details.edit} edit` : '',
    details.delete > 0 ? `${details.delete} delete` : '',
  ].filter(Boolean)

  return parts.length > 0
    ? `storm ${parts.join(' / ')}${details.buffered > 0 ? `, buffered ${details.buffered}` : ''}`
    : 'storm buffered pending appends'
}

export function resolveAdvancedMockEffect(input: {
  visibleTailAppendCount: number
  visibleOutOfOrderAppendCount: number
  visiblePatchCount: number
  visibleDeleteCount: number
  feedOnlyChangeCount: number
}): DemoViewportEffect {
  if (input.visibleDeleteCount > 0) {
    return 'anchor-risk'
  }

  if (input.visibleOutOfOrderAppendCount > 0) {
    return 'items-change'
  }

  if (input.visibleTailAppendCount > 0) {
    return 'append'
  }

  if (input.visiblePatchCount > 0) {
    return 'items-change'
  }

  if (input.feedOnlyChangeCount > 0) {
    return 'none'
  }

  return 'none'
}

export function resolveAdvancedMockSnapshotKind(input: {
  effect: DemoViewportEffect
  visibleTailAppendCount: number
  visibleOutOfOrderAppendCount: number
  visibleDeleteCount: number
}): AdvancedMockSnapshotKind {
  if (input.visibleDeleteCount > 0) {
    return 'delete'
  }

  if (
    input.effect === 'append' &&
    input.visibleTailAppendCount > 0 &&
    input.visibleOutOfOrderAppendCount === 0
  ) {
    return 'append'
  }

  return 'patch'
}

export function updateMessageCollections(input: {
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
  messageId: string
  mutate: (message: DemoMessage) => DemoMessage | null
}): {
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
} {
  let nextMessage: DemoMessage | null = null

  return {
    feedMessages: input.feedMessages.flatMap((message) => {
      if (message.id !== input.messageId) {
        return [message]
      }

      nextMessage = input.mutate(message)
      return nextMessage ? [nextMessage] : []
    }),
    messages: input.messages.flatMap((message) => {
      if (message.id !== input.messageId) {
        return [message]
      }

      if (nextMessage === null) {
        nextMessage = input.mutate(message)
      }

      return nextMessage ? [nextMessage] : []
    }),
  }
}

export function deleteMessageCollections(input: {
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
  messageIds: string[]
}): {
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
} {
  const deletedIds = new Set(input.messageIds)

  return {
    feedMessages: input.feedMessages.filter(
      (message) => !deletedIds.has(message.id),
    ),
    messages: input.messages.filter((message) => !deletedIds.has(message.id)),
  }
}

export function pickStormDeleteTargets(
  messages: DemoMessage[],
  random: RandomSource,
): {
  mode: StormDeleteMode
  targets: DemoMessage[]
} | null {
  const hotWindow = messages
    .slice(-Math.min(STORM_DELETE_HOT_WINDOW_SIZE, messages.length))
    .filter((message) => message.tone !== 'system')

  if (hotWindow.length === 0) {
    return null
  }

  const modeRoll = random()

  if (modeRoll < 0.5) {
    return {
      mode: 'single',
      targets: [pickOne(hotWindow, random)],
    }
  }

  if (modeRoll < 0.8) {
    const count = Math.min(pickInteger(3, 6, random), hotWindow.length)
    const startIndex = pickInteger(0, hotWindow.length - count, random)

    return {
      mode: 'contiguous',
      targets: hotWindow.slice(startIndex, startIndex + count),
    }
  }

  const count = Math.min(pickInteger(2, 10, random), hotWindow.length)

  return {
    mode: 'jump',
    targets: pickNonContiguousMessages(hotWindow, count, random),
  }
}

export function pickVisibleTarget(
  messages: DemoMessage[],
  random: RandomSource,
  predicate: (message: DemoMessage) => boolean = () => true,
): DemoMessage | null {
  const hotWindow = messages.slice(-Math.min(36, messages.length))
  const candidates = hotWindow.filter(predicate)

  if (candidates.length === 0) {
    return null
  }

  return candidates[pickInteger(0, candidates.length - 1, random)] ?? null
}

export function expandMockBodyToLineCount(body: string, lineCount: number): string {
  const sourceLines = body.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const lines = sourceLines.length > 0 ? sourceLines : [body]

  return Array.from({ length: Math.max(1, lineCount) }, (_, index) =>
    lines[index % lines.length] ?? '',
  ).join('\n')
}

export function pickDeterministicLineCount(id: string, min: number, max: number): number {
  const lower = Math.max(1, Math.min(min, max))
  const upper = Math.max(lower, max)
  return lower + (Math.abs(hashCode(id)) % (upper - lower + 1))
}

export function createBotBody(
  message: DemoMessage,
  statusText: string,
  batchIndex: number,
): string {
  const prefix = `${message.id} ${statusText}`
  const suffix = batchIndex === 0 ? '' : ` #${batchIndex + 1}`
  const lineCount = pickDeterministicLineCount(
    `${message.id}:bot:${batchIndex}`,
    message.kind === 'longText' ? 6 : 1,
    message.kind === 'album' ? 6 : 10,
  )

  if (message.kind === 'longText') {
    return expandMockBodyToLineCount(`${prefix}${suffix}\n${message.body}`, lineCount)
  }

  if (message.kind === 'image') {
    return expandMockBodyToLineCount(
      `${prefix}${suffix} 附带了一张自动生成的截图。`,
      Math.min(lineCount, 5),
    )
  }

  if (message.kind === 'video') {
    return expandMockBodyToLineCount(
      `${prefix}${suffix} 附带了一个视频预览。`,
      Math.min(lineCount, 5),
    )
  }

  if (message.kind === 'album') {
    return expandMockBodyToLineCount(
      `${prefix}${suffix} 附带了一组图片。`,
      lineCount,
    )
  }

  return expandMockBodyToLineCount(`${prefix}${suffix}`, lineCount)
}

export function upsertMessagesBySequence(
  current: DemoMessage[],
  additions: DemoMessage[],
): DemoMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))

  for (const message of additions) {
    byId.set(message.id, message)
  }

  return Array.from(byId.values()).sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence
    }

    return left.id.localeCompare(right.id)
  })
}

export function getMaxSequence(messages: DemoMessage[]): number {
  return messages.reduce(
    (max, message) => Math.max(max, message.sequence),
    Number.NEGATIVE_INFINITY,
  )
}

export function pickOne<T>(items: T[], random: RandomSource): T {
  return items[pickInteger(0, items.length - 1, random)] ?? items[0]
}

export function pickInteger(
  minInclusive: number,
  maxInclusive: number,
  random: RandomSource,
): number {
  if (maxInclusive <= minInclusive) {
    return minInclusive
  }

  return (
    minInclusive +
    Math.floor(random() * (maxInclusive - minInclusive + 1))
  )
}

function pickNonContiguousMessages(
  messages: DemoMessage[],
  count: number,
  random: RandomSource,
): DemoMessage[] {
  const selectedIndexes: number[] = []

  while (selectedIndexes.length < count) {
    const sparseCandidates = messages
      .map((_, index) => index)
      .filter((index) =>
        !selectedIndexes.includes(index) &&
        !selectedIndexes.some((selected) => Math.abs(selected - index) <= 1),
      )
    const candidates =
      sparseCandidates.length > 0
        ? sparseCandidates
        : messages
          .map((_, index) => index)
          .filter((index) => !selectedIndexes.includes(index))

    if (candidates.length === 0) {
      break
    }

    selectedIndexes.push(pickOne(candidates, random))
  }

  return selectedIndexes
    .sort((left, right) => left - right)
    .map((index) => messages[index])
    .filter((message): message is DemoMessage => Boolean(message))
}

function hashCode(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return hash
}
