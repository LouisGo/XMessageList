/**
 * Demo BFF 层类型定义。
 *
 * 对齐 typex-pc Bridge 层的 getMessagesAround / getLatestMessages 契约，
 * 省略 SDK 专属字段（sdkDurationMs, rawPayloadChars, bypassCache, cacheHit），
 * 只保留业务语义字段。
 */

// ---- Anchor ----

export type MessageIdentityAnchor = {
  messageId: string
  position?: number
}

// ---- Request Types ----

export type GetMessagesAroundReq = {
  feedId: string
  anchor: MessageIdentityAnchor
  before: number
  after: number
}

export type GetLatestMessagesReq = {
  feedId: string
  /** 首屏默认到底窗口大小；未传时按 40 兜底。 */
  limit?: number
}

// ---- Response Types ----

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
