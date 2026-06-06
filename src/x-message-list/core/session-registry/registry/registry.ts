import { MessageListSession } from '../session/session'
import type {
  MessageListSegmentRetention,
  MessageListSessionId,
  MessageListSessionSource,
  MessageListSessionRegistry,
  MessageListSessionRegistryEntry,
  MessageListSessionRegistryOptions,
  MessageListSessionRegistryOptionsPatch,
  MessageListSessionRetainReason,
  MessageListSession as PublicMessageListSession,
} from '../contracts'

const DEFAULT_PAGE_SIZE = 32
const DEFAULT_RETENTION: MessageListSegmentRetention = 'balanced'
const DEFAULT_MAX_SESSIONS = 20
const DEFAULT_TTL_MS = 10 * 60_000

type NormalizedDefaults = {
  pageSize: number
  retention: MessageListSegmentRetention
  keepAlive: {
    maxSessions: number
    ttlMs: number
  }
}

type SessionRecord<Row, Source> = {
  session: MessageListSession<Row, Source>
  createdAt: number
  hostRetains: Map<MessageListSessionRetainReason, number>
}

export class ApplicationMessageListSessionRegistry<Row, Source = MessageListSessionSource>
  implements MessageListSessionRegistry<Row, Source> {
  private readonly sessions = new Map<
    MessageListSessionId,
    SessionRecord<Row, Source>
  >()
  private defaults: NormalizedDefaults
  private lastSweepAt = 0

  constructor(
    private options: MessageListSessionRegistryOptions<Row, Source>,
  ) {
    this.defaults = normalizeDefaults(options.defaults)
  }

  getSession(sessionId: MessageListSessionId): PublicMessageListSession<Row> {
    this.sweep()
    const existing = this.sessions.get(sessionId)?.session

    if (existing) {
      existing.lastUsedAt = Date.now()
      return existing
    }

    const source = this.getSessionSource(sessionId)
    const adapter = this.options.getAdapter(source)
    const session = new MessageListSession({
      sessionId,
      source,
      adapter,
      defaults: this.defaults,
      tailEvents: {
        getPageFocus: () => resolvePageFocus(
          this.options.tailEvents?.getPageFocus,
        ),
        shouldFollowRemoteAppend: (context) =>
          this.options.tailEvents?.shouldFollowRemoteAppend?.(context),
      },
      scrollMotion: {
        enabled: () => {
          const enabled = this.options.scrollMotion?.enabled
          return typeof enabled === 'function' ? enabled() : enabled ?? true
        },
      },
      onRequestResult: (result) => this.options.onRequestResult?.(result),
      onRuntimeEvent: (event) => this.options.onRuntimeEvent?.(event),
    })

    this.sessions.set(sessionId, {
      session,
      createdAt: Date.now(),
      hostRetains: new Map(),
    })
    this.evictOverflow()
    return session
  }

  hasSession(sessionId: MessageListSessionId): boolean {
    return this.sessions.has(sessionId)
  }

  destroySession(sessionId: MessageListSessionId): boolean {
    const session = this.sessions.get(sessionId)?.session

    if (!session) {
      return false
    }

    session.destroy()
    return this.sessions.delete(sessionId)
  }

  destroyAll(): void {
    for (const { session } of this.sessions.values()) {
      session.destroy()
    }
    this.sessions.clear()
  }

  getSessionIds(): MessageListSessionId[] {
    return Array.from(this.sessions.keys())
  }

  getSessionMeta(sessionId: MessageListSessionId): MessageListSessionRegistryEntry | null {
    const record = this.sessions.get(sessionId)

    if (!record) {
      return null
    }

    const mountedRetainCount = record.session.getViewRetainCount()
    const hostRetainCount = getHostRetainCount(record)

    return {
      sessionId,
      createdAt: record.createdAt,
      lastUsedAt: record.session.lastUsedAt,
      mountedRetainCount,
      hostRetainCount,
      status: mountedRetainCount > 0
        ? 'mounted'
        : hostRetainCount > 0
          ? 'active'
          : 'cached',
    }
  }

  retainSession(
    sessionId: MessageListSessionId,
    reason: MessageListSessionRetainReason,
  ): () => void {
    this.getSession(sessionId)
    const record = this.sessions.get(sessionId)

    if (!record) {
      return () => undefined
    }

    record.session.lastUsedAt = Date.now()
    record.hostRetains.set(reason, (record.hostRetains.get(reason) ?? 0) + 1)
    record.session.ensureBootstrapStarted()

    let released = false
    return () => {
      if (released) {
        return
      }

      released = true
      const current = record.hostRetains.get(reason) ?? 0
      if (current <= 1) {
        record.hostRetains.delete(reason)
      } else {
        record.hostRetains.set(reason, current - 1)
      }
      record.session.lastUsedAt = Date.now()
    }
  }

  updateOptions(options: MessageListSessionRegistryOptionsPatch<Row, Source>): void {
    this.options = {
      ...this.options,
      defaults: {
        ...this.options.defaults,
        pageSize: options.defaults?.pageSize ??
          this.options.defaults?.pageSize,
        keepAlive: {
          ...this.options.defaults?.keepAlive,
          ...options.defaults?.keepAlive,
        },
      },
      tailEvents: options.tailEvents
        ? { ...this.options.tailEvents, ...options.tailEvents }
        : this.options.tailEvents,
      scrollMotion: options.scrollMotion ?? this.options.scrollMotion,
      onRequestResult: options.onRequestResult ?? this.options.onRequestResult,
      onRuntimeEvent: options.onRuntimeEvent ?? this.options.onRuntimeEvent,
    }
    const nextDefaults = normalizeDefaults(this.options.defaults)
    this.defaults.pageSize = nextDefaults.pageSize
    this.defaults.keepAlive = nextDefaults.keepAlive
    this.sweep()
    this.evictOverflow()
  }

  sweep(): void {
    const now = Date.now()
    if (now - this.lastSweepAt < 5_000) return
    this.lastSweepAt = now

    const ttl = this.defaults.keepAlive.ttlMs

    if (ttl <= 0) {
      return
    }

    for (const [sessionId, record] of this.sessions) {
      if (this.isActiveRecord(record)) {
        continue
      }

      if (now - record.session.lastUsedAt > ttl) {
        this.destroySession(sessionId)
      }
    }
  }

  private getSessionSource(sessionId: MessageListSessionId): Source {
    if (this.options.getSessionSource) {
      return this.options.getSessionSource(sessionId)
    }

    return sessionId as Source
  }

  private evictOverflow(): void {
    const maxSessions = this.defaults.keepAlive.maxSessions
    if (maxSessions <= 0) return

    // Single pass: collect cached (non-active) records with their lastUsedAt
    const cached: Array<[MessageListSessionId, number]> = []
    for (const [sessionId, record] of this.sessions) {
      if (!this.isActiveRecord(record)) {
        cached.push([sessionId, record.session.lastUsedAt])
      }
    }

    const overflow = cached.length - maxSessions
    if (overflow <= 0) return

    // Sort once by lastUsedAt ascending (oldest first), then destroy the overflow
    cached.sort((a, b) => a[1] - b[1])
    for (let i = 0; i < overflow; i++) {
      this.destroySession(cached[i][0])
    }
  }

  private isActiveRecord(record: SessionRecord<Row, Source>): boolean {
    return record.session.hasRetainedView() || getHostRetainCount(record) > 0
  }

}

export function createMessageListSessionRegistry<
  Row,
  Source = MessageListSessionSource,
>(
  options: MessageListSessionRegistryOptions<Row, Source>,
): MessageListSessionRegistry<Row, Source> {
  return new ApplicationMessageListSessionRegistry<Row, Source>(options)
}

function normalizeDefaults(
  defaults: MessageListSessionRegistryOptions<unknown>['defaults'],
): NormalizedDefaults {
  return {
    pageSize: defaults?.pageSize ?? DEFAULT_PAGE_SIZE,
    retention: defaults?.retention ?? DEFAULT_RETENTION,
    keepAlive: {
      maxSessions: defaults?.keepAlive?.maxSessions ?? DEFAULT_MAX_SESSIONS,
      ttlMs: defaults?.keepAlive?.ttlMs ?? DEFAULT_TTL_MS,
    },
  }
}

function getHostRetainCount<Row, Source>(record: SessionRecord<Row, Source>): number {
  let count = 0

  for (const value of record.hostRetains.values()) {
    count += value
  }

  return count
}

function resolvePageFocus(getPageFocus?: () => boolean): boolean {
  if (getPageFocus) {
    return getPageFocus()
  }

  return globalThis.document?.hasFocus?.() ?? true
}
