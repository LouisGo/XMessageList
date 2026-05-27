import type { DemoMessage } from './demoData'

export type DemoOperationName =
  | 'feed.load'
  | 'feed.seed'
  | 'feed.select'
  | 'feed.clear'
  | 'history.prepend'
  | 'history.append'
  | 'history.latest'
  | 'history.around'
  | 'message.append'
  | 'message.longBurst'
  | 'message.edit'
  | 'message.delete'
  | 'message.react'
  | 'message.resize'
  | 'message.send'
  | 'mock.eventStorm'
  | 'mock.botPush'
  | 'runtime.command.followBottom'
  | 'runtime.command.quoteJump'
  | 'runtime.event'

export type DemoLogPhase =
  | 'start'
  | 'success'
  | 'error'
  | 'skip'
  | 'cancel'
  | 'info'

export type DemoLogEntry = {
  requestId: string
  operation: DemoOperationName
  phase: DemoLogPhase
  feedId?: string
  messageCount?: number
  details?: Record<string, unknown>
  error?: string
}

export type PersistedViewportAnchor = {
  messageId: string
  position?: number
  offsetWithinMessage: number
}

export type PersistedDemoFeed = {
  version: 1
  feedId: string
  revision: number
  hasMoreBefore?: boolean
  lastViewportAnchor?: PersistedViewportAnchor
  messages: DemoMessage[]
  updatedAt: string
}

const API_BASE = '/__x-message-list-demo'
const FEED_STORAGE_PREFIX = 'x-message-list:demo-feed:'
const LOG_STORAGE_KEY = 'x-message-list:demo-fallback-logs'

export async function loadPersistedDemoFeed(
  feedId: string,
): Promise<PersistedDemoFeed | null> {
  try {
    const response = await fetch(`${API_BASE}/feeds/${encodeURIComponent(feedId)}`)

    if (!response.ok) {
      throw new Error(`load feed failed: ${response.status}`)
    }

    const payload = (await response.json()) as { feed: PersistedDemoFeed | null }
    return payload.feed
  } catch {
    return loadFallbackFeed(feedId)
  }
}

export async function savePersistedDemoFeed(
  feed: PersistedDemoFeed,
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/feeds/${encodeURIComponent(feed.feedId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feed }),
    })

    if (!response.ok) {
      throw new Error(`save feed failed: ${response.status}`)
    }

    return
  } catch {
    saveFallbackFeed(feed)
  }
}

export async function writeDemoLog(entry: DemoLogEntry): Promise<void> {
  const payload = {
    ...entry,
    clientTime: new Date().toISOString(),
  }

  try {
    const response = await fetch(`${API_BASE}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })

    if (!response.ok) {
      throw new Error(`write log failed: ${response.status}`)
    }

    return
  } catch {
    saveFallbackLog(payload)
  }
}

export function createDemoRequestId(operation: DemoOperationName): string {
  return `${operation}:${Date.now()}:${Math.random().toString(16).slice(2)}`
}

function loadFallbackFeed(feedId: string): PersistedDemoFeed | null {
  const raw = window.localStorage.getItem(`${FEED_STORAGE_PREFIX}${feedId}`)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as PersistedDemoFeed
  } catch {
    return null
  }
}

function saveFallbackFeed(feed: PersistedDemoFeed): void {
  window.localStorage.setItem(
    `${FEED_STORAGE_PREFIX}${feed.feedId}`,
    JSON.stringify(feed),
  )
}

function saveFallbackLog(entry: DemoLogEntry & { clientTime: string }): void {
  const raw = window.localStorage.getItem(LOG_STORAGE_KEY)
  const current = raw ? (JSON.parse(raw) as unknown[]) : []
  const next = [...current.slice(-199), entry]

  window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(next))
}
