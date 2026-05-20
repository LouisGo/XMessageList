export type RuntimeNextCommandTarget = {
  readonly messageId: string
  readonly align?: 'start' | 'center' | 'end' | 'nearest'
}

export type RuntimeNextCommand =
  | {
      readonly type: 'bootstrap'
      readonly mode: 'latest' | 'restore'
      readonly target?: RuntimeNextCommandTarget
    }
  | {
      readonly type: 'jump'
      readonly target: RuntimeNextCommandTarget
    }
  | {
      readonly type: 'restore'
      readonly target: RuntimeNextCommandTarget
    }
  | {
      readonly type: 'followBottom'
    }
  | {
      readonly type: 'reset'
      readonly reason: 'feed-change' | 'generation-change' | 'manual'
    }

