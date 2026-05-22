import type {
  MessageDataSnapshot,
  MessageDataSnapshotChange,
  NonEmptyMessageIdentityRemaps,
} from '..'

export type TestMessage = {
  id: string
  text: string
}

type CreateSnapshotEffect = NonNullable<
  MessageDataSnapshot['change']['viewportModifier']
>

type CreateSnapshotBaseInput = {
  count: number
  revision: number
  effect: CreateSnapshotEffect
  start?: number
  estimatedHeight?: number
  hasMoreAfter?: boolean
  hasMoreBefore?: boolean
  kind?: MessageDataSnapshot['change']['kind']
  anchor?: MessageDataSnapshot['anchor']
  anchorStatus?: MessageDataSnapshot['anchorStatus']
}

type CreateSnapshotInput =
  | (Omit<CreateSnapshotBaseInput, 'effect' | 'kind'> & {
      effect: 'identity-remap'
      kind?: 'identityRebind'
      identityRemaps: NonEmptyMessageIdentityRemaps
    })
  | (CreateSnapshotBaseInput & {
      effect: Exclude<CreateSnapshotEffect, 'identity-remap'>
      identityRemaps?: never
    })

export function createSnapshot(
  input: CreateSnapshotInput,
): MessageDataSnapshot<TestMessage> {
  const start = input.start ?? 1
  const estimatedHeight = input.estimatedHeight ?? 50
  const change = createSnapshotChange(input)

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
    change,
  }
}

export function cloneSnapshotWithItems(
  snapshot: MessageDataSnapshot<TestMessage>,
  input: {
    revision: number
    items: MessageDataSnapshot<TestMessage>['items']
    effect?: Exclude<CreateSnapshotEffect, 'identity-remap'>
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
    },
  }
}

function createSnapshotChange(
  input: CreateSnapshotInput,
): MessageDataSnapshotChange {
  if (input.effect === 'identity-remap') {
    return {
      kind: input.kind ?? 'identityRebind',
      viewportModifier: 'identity-remap',
      identityRemaps: input.identityRemaps,
    }
  }

  return {
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
