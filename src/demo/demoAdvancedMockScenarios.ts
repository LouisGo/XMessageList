import {
  createDemoMessageId,
  createNewestMessage,
  getNextMessageSequence,
  maybeAttachRandomQuote,
  type DemoMessage,
  type DemoViewportEffect,
} from './demoData'

const EVENT_STORM_MIN_DELAY_MS = 90
const EVENT_STORM_MAX_DELAY_MS = 250
const BOT_PUSH_MIN_DELAY_MS = 650
const BOT_PUSH_MAX_DELAY_MS = 1_300
const MAX_STORM_BUFFERED_APPENDS = 7
const STORM_DELETE_HOT_WINDOW_SIZE = 100

const GROUP_AUTHORS = [
  'Ada',
  'Ben',
  'Chen',
  'Dina',
  'Eli',
  'Fran',
  'Gita',
  'Hugo',
  'Iris',
  'Jae',
]

const STORM_TEXTS = [
  '线上大群里突然插入的一条讨论，顺序可能晚于实际发送时间。',
  '这里补充一个排查结果，大家可以先看最新的上下文。',
  '我这边刚刚收到服务端事件，先把状态同步出来。',
  '这条消息用于压测尾部热区里的连续 arrival 和局部 patch。',
  '刚才的结论有变化，先把这一段追加进来。',
]

const BOT_AUTHORS = ['DeployBot', 'OpsBot', 'ReviewBot']

const BOT_TEXTS = [
  '任务队列有新的进展，已推送最新状态。',
  '后台同步完成，等待下一轮检查。',
  '自动巡检发现一条可读通知。',
  '流水线阶段更新，结果稍后继续推送。',
]

const EDIT_SUFFIXES = [
  '补充：刚才的信息已修正。',
  '更新：服务端顺序已经确认。',
  '补充上下文，避免误判 tail 状态。',
]

const REACTION_EMOJIS = ['😀', '😂', '🔥', '👍', '🎉', '👀', '❤️', '🚀']

export type AdvancedMockSnapshotKind = 'append' | 'patch' | 'delete' | 'reset'
type RandomSource = () => number

type StormCounterName =
  | 'append'
  | 'lateAppend'
  | 'reaction'
  | 'edit'
  | 'delete'

type StormDeleteMode = 'single' | 'contiguous' | 'jump'

type StormTickDetails = {
  tick: number
  append: number
  reaction: number
  edit: number
  delete: number
  deleteEvents: number
  deleteModes: Record<StormDeleteMode, number>
  buffered: number
}

export type AdvancedMockEventStormState = {
  nextSequence: number
  tickIndex: number
  deliveryBuffer: DemoMessage[]
  counters: Record<StormCounterName, number>
}

export type AdvancedMockPublishResult = {
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
  effect: DemoViewportEffect
  kind: AdvancedMockSnapshotKind
  eventText: string
  details: Record<string, unknown>
}

export function createEventStormState(
  feedMessages: DemoMessage[],
): AdvancedMockEventStormState {
  return {
    nextSequence: getNextMessageSequence(feedMessages),
    tickIndex: 0,
    deliveryBuffer: [],
    counters: {
      append: 0,
      lateAppend: 0,
      reaction: 0,
      edit: 0,
      delete: 0,
    },
  }
}

export function getNextEventStormDelayMs(
  random: RandomSource = Math.random,
): number {
  return pickInteger(
    EVENT_STORM_MIN_DELAY_MS,
    EVENT_STORM_MAX_DELAY_MS,
    random,
  )
}

export function getNextBotPushDelayMs(random: RandomSource = Math.random): number {
  return pickInteger(BOT_PUSH_MIN_DELAY_MS, BOT_PUSH_MAX_DELAY_MS, random)
}

export function applyEventStormTick(input: {
  feedId: string
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
  hasMoreAfter: boolean
  state: AdvancedMockEventStormState
  random?: RandomSource
}): AdvancedMockPublishResult | null {
  const random = input.random ?? Math.random
  const state = input.state

  syncStormReservedSequences({
    feedId: input.feedId,
    feedMessages: input.feedMessages,
    messages: input.messages,
    state,
  })

  const eventCount = pickStormEventCount(random)
  const details = createTickDetails(state.tickIndex + 1)
  let nextFeedMessages = input.feedMessages
  let nextMessages = input.messages
  let maxVisibleSequence = getMaxSequence(nextMessages)
  let visibleTailAppendCount = 0
  let visibleOutOfOrderAppendCount = 0
  let visiblePatchCount = 0
  let visibleDeleteCount = 0
  let feedOnlyChangeCount = 0

  state.tickIndex += 1

  for (let index = 0; index < eventCount; index += 1) {
    const eventKind = pickStormEventKind(random)

    if (eventKind === 'append') {
      const deliveries = reserveStormAppends({
        feedId: input.feedId,
        state,
        random,
      })

      for (const message of deliveries) {
        const quotedMessage = maybeAttachRandomQuote(
          message,
          nextFeedMessages,
          random,
        )
        const isOutOfOrder = quotedMessage.sequence <= maxVisibleSequence

        nextFeedMessages = upsertMessagesBySequence(nextFeedMessages, [
          quotedMessage,
        ])

        if (input.hasMoreAfter) {
          feedOnlyChangeCount += 1
        } else {
          nextMessages = upsertMessagesBySequence(nextMessages, [quotedMessage])

          if (isOutOfOrder) {
            visibleOutOfOrderAppendCount += 1
          } else {
            visibleTailAppendCount += 1
          }

          maxVisibleSequence = Math.max(maxVisibleSequence, message.sequence)
        }

        state.counters.append += 1
        if (isOutOfOrder) {
          state.counters.lateAppend += 1
        }
      }

      details.append += deliveries.length
      details.buffered = state.deliveryBuffer.length
      continue
    }

    if (eventKind === 'reaction') {
      const target = pickVisibleTarget(nextMessages, random)

      if (!target) {
        continue
      }

      const reaction = pickOne(REACTION_EMOJIS, random)
      const updated = updateMessageCollections({
        feedMessages: nextFeedMessages,
        messages: nextMessages,
        messageId: target.id,
        mutate: (message) => ({
          ...message,
          reactions: [...message.reactions, reaction],
        }),
      })

      nextFeedMessages = updated.feedMessages
      nextMessages = updated.messages
      visiblePatchCount += 1
      details.reaction += 1
      state.counters.reaction += 1
      continue
    }

    if (eventKind === 'edit') {
      const target = pickVisibleTarget(
        nextMessages,
        random,
        (message) => message.tone !== 'system',
      )

      if (!target) {
        continue
      }

      const suffix = pickOne(EDIT_SUFFIXES, random)
      const updatedBody = `${target.body}\n${suffix}`
      const updated = updateMessageCollections({
        feedMessages: nextFeedMessages,
        messages: nextMessages,
        messageId: target.id,
        mutate: (message) => ({
          ...message,
          body: updatedBody,
          kind:
            message.kind === 'text' && updatedBody.length > 180
              ? 'longText'
              : message.kind,
          editedAt: new Date().toISOString(),
        }),
      })

      nextFeedMessages = updated.feedMessages
      nextMessages = updated.messages
      visiblePatchCount += 1
      details.edit += 1
      state.counters.edit += 1
      continue
    }

    const deletion = pickStormDeleteTargets(nextMessages, random)

    if (!deletion) {
      continue
    }

    const updated = deleteMessageCollections({
      feedMessages: nextFeedMessages,
      messages: nextMessages,
      messageIds: deletion.targets.map((message) => message.id),
    })
    const deletedCount = deletion.targets.length

    nextFeedMessages = updated.feedMessages
    nextMessages = updated.messages
    visibleDeleteCount += deletedCount
    details.delete += deletedCount
    details.deleteEvents += 1
    details.deleteModes[deletion.mode] += 1
    state.counters.delete += deletedCount
  }

  if (
    nextFeedMessages === input.feedMessages &&
    nextMessages === input.messages
  ) {
    return null
  }

  const effect = resolveAdvancedMockEffect({
    visibleTailAppendCount,
    visibleOutOfOrderAppendCount,
    visiblePatchCount,
    visibleDeleteCount,
    feedOnlyChangeCount,
  })
  const kind = resolveAdvancedMockSnapshotKind({
    effect,
    visibleTailAppendCount,
    visibleOutOfOrderAppendCount,
    visibleDeleteCount,
  })

  return {
    feedMessages: nextFeedMessages,
    messages: nextMessages,
    effect,
    kind,
    eventText: formatStormEventText(details),
    details: {
      ...details,
      visibleTailAppendCount,
      visibleOutOfOrderAppendCount,
      visiblePatchCount,
      visibleDeleteCount,
      feedOnlyChangeCount,
      counters: { ...state.counters },
    },
  }
}

export function flushEventStormBuffer(input: {
  feedId: string
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
  hasMoreAfter: boolean
  state: AdvancedMockEventStormState
}): AdvancedMockPublishResult | null {
  if (input.state.deliveryBuffer.length === 0) {
    return null
  }

  const delivered = [...input.state.deliveryBuffer]
  const maxVisibleSequence = getMaxSequence(input.messages)
  const visibleOutOfOrderAppendCount = input.hasMoreAfter
    ? 0
    : delivered.filter((message) => message.sequence <= maxVisibleSequence).length
  const visibleTailAppendCount = input.hasMoreAfter
    ? 0
    : delivered.length - visibleOutOfOrderAppendCount

  input.state.deliveryBuffer = []
  input.state.counters.append += delivered.length
  input.state.counters.lateAppend += visibleOutOfOrderAppendCount

  const feedMessages = upsertMessagesBySequence(input.feedMessages, delivered)
  const messages = input.hasMoreAfter
    ? input.messages
    : upsertMessagesBySequence(input.messages, delivered)
  const effect = resolveAdvancedMockEffect({
    visibleTailAppendCount,
    visibleOutOfOrderAppendCount,
    visiblePatchCount: 0,
    visibleDeleteCount: 0,
    feedOnlyChangeCount: input.hasMoreAfter ? delivered.length : 0,
  })
  const kind = resolveAdvancedMockSnapshotKind({
    effect,
    visibleTailAppendCount,
    visibleOutOfOrderAppendCount,
    visibleDeleteCount: 0,
  })

  return {
    feedMessages,
    messages,
    effect,
    kind,
    eventText: `storm flushed ${delivered.length} delayed appends`,
    details: {
      tick: input.state.tickIndex,
      append: delivered.length,
      buffered: 0,
      visibleTailAppendCount,
      visibleOutOfOrderAppendCount,
      counters: { ...input.state.counters },
    },
  }
}

export function applyBotPushTick(input: {
  feedId: string
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
  hasMoreAfter: boolean
  random?: RandomSource
}): AdvancedMockPublishResult {
  const random = input.random ?? Math.random
  const count = pickInteger(1, 3, random)
  const startSequence = getNextMessageSequence(input.feedMessages)
  let quoteCandidates = input.feedMessages
  const pushed = Array.from({ length: count }, (_, index) => {
    const message = maybeAttachRandomQuote(
      createBotMessage(input.feedId, startSequence + index, random, index),
      quoteCandidates,
      random,
    )
    quoteCandidates = [...quoteCandidates, message]
    return message
  })
  const feedMessages = upsertMessagesBySequence(input.feedMessages, pushed)
  const messages = input.hasMoreAfter
    ? input.messages
    : upsertMessagesBySequence(input.messages, pushed)

  return {
    feedMessages,
    messages,
    effect: input.hasMoreAfter ? 'none' : 'append',
    kind: input.hasMoreAfter ? 'patch' : 'append',
    eventText: input.hasMoreAfter
      ? `bot queued ${count} messages after current window`
      : `bot pushed ${count} messages`,
    details: {
      source: 'bot-push',
      added: count,
      ids: pushed.map((message) => message.id),
      visibleInCurrentWindow: !input.hasMoreAfter,
    },
  }
}

function reserveStormAppends(input: {
  feedId: string
  state: AdvancedMockEventStormState
  random: RandomSource
}): DemoMessage[] {
  const appendCount = input.random() < 0.18 ? 2 : 1

  for (let index = 0; index < appendCount; index += 1) {
    input.state.deliveryBuffer.push(
      createStormMessage(input.feedId, input.state.nextSequence, input.random),
    )
    input.state.nextSequence += 1
  }

  const deliveries: DemoMessage[] = []
  const targetDeliveryCount = input.random() < 0.16 ? 2 : 1

  for (let index = 0; index < targetDeliveryCount; index += 1) {
    if (input.state.deliveryBuffer.length === 0) {
      break
    }

    const shouldHoldNewest =
      input.state.deliveryBuffer.length < MAX_STORM_BUFFERED_APPENDS &&
      input.random() < 0.28

    if (shouldHoldNewest && input.state.deliveryBuffer.length === 1) {
      break
    }

    const maxIndex = shouldHoldNewest
      ? input.state.deliveryBuffer.length - 2
      : input.state.deliveryBuffer.length - 1
    const deliveryIndex = pickInteger(0, Math.max(0, maxIndex), input.random)
    const [delivered] = input.state.deliveryBuffer.splice(deliveryIndex, 1)

    if (delivered) {
      deliveries.push(delivered)
    }
  }

  return deliveries
}

function syncStormReservedSequences(input: {
  feedId: string
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
  state: AdvancedMockEventStormState
}): void {
  const occupiedMessages = [...input.feedMessages, ...input.messages]
  const occupiedIds = new Set(occupiedMessages.map((message) => message.id))
  const occupiedSequences = new Set(
    occupiedMessages.map((message) => message.sequence),
  )
  const reservedIds = new Set<string>()
  const reservedSequences = new Set<number>()
  const nextKnownSequence = Math.max(
    getNextMessageSequence(input.feedMessages),
    getNextMessageSequence(input.messages),
  )
  let nextSequence = Math.max(input.state.nextSequence, nextKnownSequence)

  input.state.deliveryBuffer = input.state.deliveryBuffer.map((message) => {
    const hasConflict =
      occupiedIds.has(message.id) ||
      occupiedSequences.has(message.sequence) ||
      reservedIds.has(message.id) ||
      reservedSequences.has(message.sequence)

    if (!hasConflict) {
      reservedIds.add(message.id)
      reservedSequences.add(message.sequence)
      nextSequence = Math.max(nextSequence, message.sequence + 1)
      return message
    }

    while (
      occupiedSequences.has(nextSequence) ||
      reservedSequences.has(nextSequence) ||
      occupiedIds.has(createDemoMessageId(input.feedId, nextSequence)) ||
      reservedIds.has(createDemoMessageId(input.feedId, nextSequence))
    ) {
      nextSequence += 1
    }

    const nextId = createDemoMessageId(input.feedId, nextSequence)
    const remapped = {
      ...message,
      id: nextId,
      sequence: nextSequence,
      body: message.body.split(message.id).join(nextId),
    }

    reservedIds.add(remapped.id)
    reservedSequences.add(remapped.sequence)
    nextSequence += 1
    return remapped
  })

  input.state.nextSequence = Math.max(input.state.nextSequence, nextSequence)
}

function createStormMessage(
  feedId: string,
  sequence: number,
  random: RandomSource,
): DemoMessage {
  const base = createNewestMessage({ feedId, sequence })
  const kind = random() < 0.08 ? 'longText' : base.kind
  const body = `${base.id} ${pickOne(STORM_TEXTS, random)}`
  const lineCount = kind === 'longText'
    ? pickDeterministicLineCount(`${base.id}:storm`, 6, 10)
    : pickDeterministicLineCount(`${base.id}:storm`, 1, 10)

  return {
    ...base,
    author: pickOne(GROUP_AUTHORS, random),
    body: expandMockBodyToLineCount(body, lineCount),
    tone: 'peer',
    kind,
    expanded: random() < 0.1 ? !base.expanded : base.expanded,
    reactions: random() < 0.12 ? [pickOne(REACTION_EMOJIS, random)] : [],
  }
}

function createBotMessage(
  feedId: string,
  sequence: number,
  random: RandomSource,
  batchIndex: number,
): DemoMessage {
  const base = createNewestMessage({ feedId, sequence })
  const statusText = pickOne(BOT_TEXTS, random)
  const body = createBotBody(base, statusText, batchIndex)

  return {
    ...base,
    author: pickOne(BOT_AUTHORS, random),
    body,
    tone: 'peer',
    expanded: random() < 0.08 ? !base.expanded : base.expanded,
  }
}

function createBotBody(
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

function pickStormEventCount(random: RandomSource): number {
  const roll = random()

  if (roll < 0.72) {
    return 1
  }

  if (roll < 0.94) {
    return 2
  }

  return 3
}

function pickStormEventKind(
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

function createTickDetails(tick: number): StormTickDetails {
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

function formatStormEventText(details: StormTickDetails): string {
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

function resolveAdvancedMockEffect(input: {
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

function resolveAdvancedMockSnapshotKind(input: {
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

function updateMessageCollections(input: {
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

function deleteMessageCollections(input: {
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

function pickStormDeleteTargets(
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

function pickVisibleTarget(
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

function expandMockBodyToLineCount(body: string, lineCount: number): string {
  const sourceLines = body.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const lines = sourceLines.length > 0 ? sourceLines : [body]

  return Array.from({ length: Math.max(1, lineCount) }, (_, index) =>
    lines[index % lines.length] ?? '',
  ).join('\n')
}

function pickDeterministicLineCount(id: string, min: number, max: number): number {
  const lower = Math.max(1, Math.min(min, max))
  const upper = Math.max(lower, max)
  return lower + (Math.abs(hashCode(id)) % (upper - lower + 1))
}

function upsertMessagesBySequence(
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

function getMaxSequence(messages: DemoMessage[]): number {
  return messages.reduce(
    (max, message) => Math.max(max, message.sequence),
    Number.NEGATIVE_INFINITY,
  )
}

function pickOne<T>(items: T[], random: RandomSource): T {
  return items[pickInteger(0, items.length - 1, random)] ?? items[0]
}

function pickInteger(
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

function hashCode(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return hash
}
