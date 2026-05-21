import type {
  AnchorState,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../identity/types'
import type { RenderWindow } from '../projection/types'
import type { MessageDataSnapshot } from './types'

export type DataIntentShiftDirection = 'before' | 'after'
export type PendingDataIntentPriority = 'destination' | 'edge' | 'latest'
export type PendingFollowBottomOrigin = 'user-command' | 'auto-scroll-hint'
export type PendingSegmentShiftOrigin = 'drag' | 'wheel' | 'data'
export type PendingDestinationOrigin = 'user' | 'lifecycle'

export type PendingDataIntent =
  | {
      readonly kind: 'segmentShift'
      readonly direction: DataIntentShiftDirection
      readonly origin: PendingSegmentShiftOrigin
      readonly priority: 'edge'
    }
  | {
      readonly kind: 'followBottom'
      readonly origin: PendingFollowBottomOrigin
      readonly priority: 'latest'
    }
  | {
      readonly kind: 'jump'
      readonly target: MessageIdentityAnchor
      readonly origin: 'user'
      readonly priority: 'destination'
    }
  | {
      readonly kind: 'restore'
      readonly target: MessageIdentityAnchor | AnchorState
      readonly origin: PendingDestinationOrigin
      readonly priority: 'destination'
    }

export type DataArrivalIntent =
  | { readonly kind: 'projectionRefresh' }
  | { readonly kind: 'segmentRelayout'; readonly reason: 'resize' | 'measurement' | 'coverage-risk' | 'cap-exceeded' | 'cap-fallback' | 'spacer-oscillation' | 'bootstrap-stabilization' }
  | { readonly kind: 'segmentShift'; readonly direction: DataIntentShiftDirection }
  | { readonly kind: 'followBottom'; readonly origin: PendingFollowBottomOrigin }
  | { readonly kind: 'jump'; readonly target: MessageIdentityAnchor }
  | { readonly kind: 'restore'; readonly target: MessageIdentityAnchor | AnchorState }
  | { readonly kind: 'reset'; readonly reason: string }
  | { readonly kind: 'no-op'; readonly reason: string }

export type ActiveDataProjection = {
  readonly renderWindow: RenderWindow
  readonly logicalStartItemKey: MessageRuntimeItemKey | null
  readonly logicalEndItemKey: MessageRuntimeItemKey | null
}

export type DataArrivalClassifierInput<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  readonly snapshot: MessageDataSnapshot<TMessage, TOptimistic>
  readonly activeProjection: ActiveDataProjection | null
  readonly pendingIntent: PendingDataIntent | null
}

export type DataArrivalClassification = {
  readonly intent: DataArrivalIntent
}
