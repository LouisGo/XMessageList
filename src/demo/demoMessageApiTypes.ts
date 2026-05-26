export type MessageIdentityAnchor = {
  messageId: string
  position?: number
}

export type GetMessagesAroundReq = {
  feedId: string
  anchor: MessageIdentityAnchor
  before: number
  after: number
}

export type GetLatestMessagesReq = {
  feedId: string
  count?: number
}

export type MessagesAroundAnchorStatus = 'normal' | 'deleted'

export type MessagesAroundOkResp<TMessage = unknown> = {
  ok: true
  anchor: MessageIdentityAnchor
  anchorStatus: MessagesAroundAnchorStatus
  feedId: string
  hasMoreAfter: boolean
  hasMoreBefore: boolean
  total: number
  messages: TMessage[]
}

export type MessagesAroundErrorResp = {
  ok: false
  feedId: string
  errorCode: 'feed-not-found' | 'anchor-not-found' | 'empty-feed'
  errorMessage: string
}

export type GetMessagesAroundResp<TMessage = unknown> =
  | MessagesAroundOkResp<TMessage>
  | MessagesAroundErrorResp

export type GetLatestMessagesResp<TMessage = unknown> =
  | MessagesAroundOkResp<TMessage>
  | MessagesAroundErrorResp
