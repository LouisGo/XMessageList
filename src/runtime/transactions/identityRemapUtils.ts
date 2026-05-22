import type {
  AnchorState,
  MessageIdentityRemap,
  MessageRuntimeItemKey,
} from '../types'
import {
  areRuntimeItemKeysEqual,
  serializeRuntimeItemKey,
} from '../shared/utils'

export function migrateAnchorState(
  anchor: AnchorState,
  remaps: MessageIdentityRemap[],
): AnchorState {
  const remappedKey = remapKey(anchor.key, remaps)

  if (areRuntimeItemKeysEqual(remappedKey, anchor.key)) {
    return anchor
  }

  return {
    ...anchor,
    key: remappedKey,
  }
}

export function getValidIdentityRemaps(
  remaps: MessageIdentityRemap[] | undefined,
): MessageIdentityRemap[] {
  return (remaps ?? []).filter(
    (remap) =>
      remap.from?.kind === 'optimistic' &&
      remap.to?.kind === 'committed' &&
      serializeRuntimeItemKey(remap.from) !== serializeRuntimeItemKey(remap.to),
  )
}

function remapKey(
  key: MessageRuntimeItemKey,
  remaps: MessageIdentityRemap[],
): MessageRuntimeItemKey {
  if (key.kind !== 'optimistic') {
    return key
  }

  const serializedKey = serializeRuntimeItemKey(key)
  const remap = remaps.find(
    (candidate) => serializeRuntimeItemKey(candidate.from) === serializedKey,
  )

  return remap?.to ?? key
}
