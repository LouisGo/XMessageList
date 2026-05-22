import type { MessageDataSnapshot } from '..'

export type TestMessage = {
  id: string
  text: string
}

export function createSnapshot(input: {
  count: number
  revision: number
  effect:
    NonNullable<MessageDataSnapshot['change']['viewportModifier']>
  start?: number
  estimatedHeight?: number
  hasMoreAfter?: boolean
  hasMoreBefore?: boolean
  kind?: MessageDataSnapshot['change']['kind']
  anchor?: MessageDataSnapshot['anchor']
  anchorStatus?: MessageDataSnapshot['anchorStatus']
  identityRemaps?: MessageDataSnapshot['change']['identityRemaps']
}): MessageDataSnapshot<TestMessage> {
  const start = input.start ?? 1
  const estimatedHeight = input.estimatedHeight ?? 50

  return {
    feedId: 'feed',
    generation: 1,
    revision: input.revision,
    items: Array.from({ length: input.count }, (_, index) => {
      const id = `m-${start + index}`

      return {
        kind: 'committed' as const,
        key: { kind: 'committed' as const, messageId: id },
        message: { id, text: id },
        version: 1,
        contentVersion: 1,
        estimatedHeight,
      }
    }),
    anchor: input.anchor ?? { messageId: `m-${start + input.count - 1}` },
    anchorStatus: input.anchorStatus ?? 'normal',
    hasMoreBefore: input.hasMoreBefore ?? true,
    hasMoreAfter: input.hasMoreAfter ?? false,
    change: {
      kind:
        input.kind ??
        (input.effect === 'prepend'
          ? 'prepend'
          : input.effect === 'append' || input.effect === 'auto-scroll-to-bottom'
            ? 'append'
            : input.effect === 'reset'
              ? 'reset'
              : 'patch'),
      viewportModifier: input.effect,
      identityRemaps: input.identityRemaps,
    },
  }
}

export function cloneSnapshotWithItems(
  snapshot: MessageDataSnapshot<TestMessage>,
  input: {
    revision: number
    items: MessageDataSnapshot<TestMessage>['items']
    effect?: NonNullable<MessageDataSnapshot['change']['viewportModifier']>
    identityRemaps?: MessageDataSnapshot['change']['identityRemaps']
  },
): MessageDataSnapshot<TestMessage> {
  const lastItem = input.items.at(-1)

  return {
    ...snapshot,
    revision: input.revision,
    items: input.items,
    anchor:
      lastItem?.key.kind === 'committed'
        ? { messageId: lastItem.key.messageId }
        : snapshot.anchor,
    change: {
      kind: 'patch',
      viewportModifier: input.effect ?? 'items-change',
      identityRemaps: input.identityRemaps,
    },
  }
}

export function createHeightMap(
  start: number,
  end: number,
  height: number,
): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: end - start + 1 }, (_, index) => [
      `m-${start + index}`,
      height,
    ]),
  )
}
