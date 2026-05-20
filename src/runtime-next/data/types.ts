export type RuntimeNextDataItem<TPayload = unknown> = {
  readonly key: string
  readonly payload: TPayload
  readonly estimatedHeight?: number
}

export type RuntimeNextDataSnapshot<TPayload = unknown> = {
  readonly feedId: string
  readonly generation: number
  readonly dataRevision: number
  readonly items: readonly RuntimeNextDataItem<TPayload>[]
  readonly hasMoreBefore: boolean
  readonly hasMoreAfter: boolean
}

