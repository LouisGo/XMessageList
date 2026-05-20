import type {
  AnchorState,
} from '../../identity/types'
import type {
  MessageDataItem,
  RenderWindow,
} from '../../projection/types'
import type { PhysicalSegmentConfig } from '../config/config'

export type PhysicalRowSelectionDirectionHint =
  | 'latest'
  | 'target'
  | 'before'
  | 'after'

export type PhysicalRowSelectionInput<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  readonly items: readonly MessageDataItem<TMessage, TOptimistic>[]
  readonly anchor?: AnchorState | null
  readonly directionHint?: PhysicalRowSelectionDirectionHint
  readonly physicalWindowHeight?: number
  readonly maxMountedHeight?: number
  readonly config?: PhysicalSegmentConfig
}

export type PhysicalRowCapFallbackIntent = {
  readonly kind: 'exceptional-row'
  readonly reason: 'anchor-row-exceeds-mounted-budget'
  readonly rowIndex: number
  readonly rowHeightEstimate: number
}

export type PhysicalRowSelection = RenderWindow & {
  readonly mountedRowsHeightEstimate: number
  readonly anchorIndex: number | null
  readonly capFallbackIntent: PhysicalRowCapFallbackIntent | null
}
