import type {
  MessageDataItem,
  MessageIdentityAnchor,
} from '../../runtime/index'
import type {
  IdentityRemapInput,
} from '../loaded-segment-store/index'
import {
  applyIdentityRemaps,
  appendSegmentItems,
  mutateSegmentItems,
  patchSegmentItems,
} from '../loaded-segment-store/segmentOperations'
import type {
  MessageListIdentityRemap,
  MessageListRowsMutation,
} from '../contracts'

export const MAX_RELOAD_JOURNAL_ENTRIES = 256

type ReloadJournalOperation<Row> =
  | {
      type: 'patch'
      items: MessageDataItem<Row>[]
    }
  | {
      type: 'mutate'
      patches: MessageDataItem<Row>[]
      removeKeys: string[]
      invalidateKeys: string[]
      removed: RemovalDescriptor[]
    }
  | {
      type: 'identity-remap'
      remaps: IdentityRemapInput
    }
  | {
      type: 'append'
      items: MessageDataItem<Row>[]
      retireKeys: string[]
      removed: RemovalDescriptor[]
    }

type RemovalDescriptor = {
  key: string
  successorKey?: string
  predecessorKey?: string
}

export class ReloadContentJournal<Row> {
  private readonly operations: ReloadJournalOperation<Row>[] = []
  private entryCount = 0

  constructor(private readonly options: {
    toItems: (rows: Row[]) => MessageDataItem<Row>[]
    toIdentityRemaps: (remaps: MessageListIdentityRemap[]) => IdentityRemapInput
  }) {}

  recordPatch(rows: Row[]): boolean {
    return this.record({
      type: 'patch',
      items: this.toItems(rows),
    }, rows.length)
  }

  recordMutation(
    mutation: MessageListRowsMutation<Row>,
    beforeItems: MessageDataItem<Row>[],
  ): boolean {
    const patches = mutation.patches ?? []
    const removeKeys = mutation.removeKeys ?? []
    const invalidateKeys = mutation.invalidateKeys ?? []
    const patchItems = this.toItems(patches)
    const removed = mutateSegmentItems(beforeItems, {
      patches: patchItems,
      removeKeys,
      invalidateKeys,
    }).removed
    return this.record({
      type: 'mutate',
      patches: patchItems,
      removeKeys: [...removeKeys],
      invalidateKeys: [...invalidateKeys],
      removed,
    }, patches.length + removeKeys.length + invalidateKeys.length)
  }

  recordIdentityRemap(remaps: MessageListIdentityRemap[]): boolean {
    return this.record({
      type: 'identity-remap',
      remaps: this.options.toIdentityRemaps(remaps),
    }, remaps.length)
  }

  recordAppend(
    rows: Row[],
    retireKeys: string[] = [],
    beforeItems: MessageDataItem<Row>[],
  ): boolean {
    const items = this.toItems(rows)
    const removed = mutateSegmentItems(beforeItems, {
      patches: [],
      removeKeys: retireKeys,
      invalidateKeys: [],
    }).removed.map((entry) => ({
      ...entry,
      successorKey: entry.successorKey ?? items[0]?.key,
    }))
    return this.record({
      type: 'append',
      items,
      retireKeys: [...retireKeys],
      removed,
    }, rows.length + retireKeys.length)
  }

  rebaseItems(items: MessageDataItem<Row>[]): MessageDataItem<Row>[] {
    let rebased = items
    for (const operation of this.operations) {
      if (operation.type === 'patch') {
        rebased = patchSegmentItems(rebased, operation.items)
        continue
      }
      if (operation.type === 'mutate') {
        rebased = mutateSegmentItems(rebased, {
          patches: operation.patches,
          removeKeys: operation.removeKeys,
          invalidateKeys: operation.invalidateKeys,
        }).items
        continue
      }
      if (operation.type === 'identity-remap') {
        rebased = applyIdentityRemaps(rebased, operation.remaps)
        continue
      }
      rebased = appendSegmentItems(
        rebased,
        operation.items,
        operation.retireKeys,
      )
    }
    return rebased
  }

  rebaseAnchor(anchor: MessageIdentityAnchor): MessageIdentityAnchor {
    let rebased = anchor
    for (const operation of this.operations) {
      if (operation.type !== 'identity-remap') continue
      const remap = operation.remaps.find((candidate) =>
        anchorsMatch(rebased, candidate.from)
      )
      if (remap) rebased = remap.to
    }
    return rebased
  }

  resolveRebasedItem(
    original: MessageDataItem<Row>,
    rebasedItems: MessageDataItem<Row>[],
  ): { item: MessageDataItem<Row>; fellBack: boolean } | null {
    let candidates: Array<{
      key: string
      anchor?: MessageIdentityAnchor
      fellBack: boolean
    }> = [{
      key: original.key,
      anchor: original.identity,
      fellBack: false,
    }]

    for (const operation of this.operations) {
      if (operation.type === 'mutate' || operation.type === 'append') {
        candidates = candidates.flatMap((candidate) => {
          const removed = operation.removed.find((entry) =>
            entry.key === candidate.key
          )
          if (!removed) return [candidate]
          return [removed.successorKey, removed.predecessorKey]
            .filter((key): key is string => Boolean(key))
            .map((key) => ({ key, fellBack: true }))
        })
        continue
      }
      if (operation.type !== 'identity-remap') continue
      candidates = candidates.map((candidate) => {
        const remap = operation.remaps.find((entry) =>
          entry.previousKey === candidate.key ||
          Boolean(candidate.anchor && anchorsMatch(candidate.anchor, entry.from))
        )
        return remap
          ? { ...candidate, key: remap.nextKey, anchor: remap.to }
          : candidate
      })
    }

    for (const candidate of dedupeCandidates(candidates)) {
      const item = rebasedItems.find((entry) => entry.key === candidate.key)
      if (item) return { item, fellBack: candidate.fellBack }
    }
    return null
  }

  private record(
    operation: ReloadJournalOperation<Row>,
    entryCount: number,
  ): boolean {
    if (entryCount === 0) return true
    if (this.entryCount + entryCount > MAX_RELOAD_JOURNAL_ENTRIES) return false
    this.entryCount += entryCount
    this.operations.push(operation)
    return true
  }

  private toItems(rows: Row[]): MessageDataItem<Row>[] {
    return this.options.toItems(rows)
  }
}

function anchorsMatch(
  left: MessageIdentityAnchor,
  right: MessageIdentityAnchor,
): boolean {
  return left.sessionId === right.sessionId && (
    left.stableId === right.stableId ||
    Boolean(left.serverId && left.serverId === right.serverId) ||
    Boolean(left.localId && left.localId === right.localId)
  )
}

function dedupeCandidates<T extends { key: string }>(candidates: T[]): T[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.key)) return false
    seen.add(candidate.key)
    return true
  })
}
