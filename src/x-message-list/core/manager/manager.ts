import { MessageListSession } from './session'
import type {
  MessageListConversationId,
  MessageListManager,
  MessageListManagerOptions,
  MessageListSession as PublicMessageListSession,
} from './types'

const DEFAULT_PAGE_SIZE = 30
const DEFAULT_MAX_ITEMS = 300
const DEFAULT_MAX_SESSIONS = 20
const DEFAULT_TTL_MS = 10 * 60_000

type NormalizedDefaults = {
  pageSize: number
  maxItems: number
  keepAlive: {
    maxSessions: number
    ttlMs: number
  }
}

export class ApplicationMessageListManager<Row, Conversation = MessageListConversationId>
  implements MessageListManager<Row> {
  private readonly sessions = new Map<
    MessageListConversationId,
    MessageListSession<Row, Conversation>
  >()
  private readonly defaults: NormalizedDefaults

  constructor(
    private readonly options: MessageListManagerOptions<Row, Conversation>,
  ) {
    this.defaults = normalizeDefaults(options.defaults)
  }

  getSession(id: MessageListConversationId): PublicMessageListSession<Row> {
    this.sweep()
    const existing = this.sessions.get(id)

    if (existing) {
      existing.lastUsedAt = Date.now()
      return existing
    }

    const conversation = this.getConversation(id)
    const adapter = this.options.getAdapter(conversation)
    const session = new MessageListSession({
      id,
      conversation,
      adapter,
      defaults: this.defaults,
      incoming: this.options.incoming,
      onRequestResult: this.options.onRequestResult,
    })

    this.sessions.set(id, session)
    this.evictOverflow()
    return session
  }

  hasSession(id: MessageListConversationId): boolean {
    return this.sessions.has(id)
  }

  destroySession(id: MessageListConversationId): boolean {
    const session = this.sessions.get(id)

    if (!session) {
      return false
    }

    session.destroy()
    return this.sessions.delete(id)
  }

  destroyAll(): void {
    for (const session of this.sessions.values()) {
      session.destroy()
    }
    this.sessions.clear()
  }

  getSessionIds(): MessageListConversationId[] {
    return Array.from(this.sessions.keys())
  }

  sweep(): void {
    const now = Date.now()
    const ttl = this.defaults.keepAlive.ttlMs

    if (ttl <= 0) {
      return
    }

    for (const [id, session] of this.sessions) {
      if (session.hasRetainedView()) {
        continue
      }

      if (now - session.lastUsedAt > ttl) {
        this.destroySession(id)
      }
    }
  }

  private getConversation(id: MessageListConversationId): Conversation {
    return this.options.getConversation
      ? this.options.getConversation(id)
      : id as Conversation
  }

  private evictOverflow(): void {
    const maxSessions = this.defaults.keepAlive.maxSessions

    if (maxSessions <= 0) {
      return
    }

    while (this.sessions.size > maxSessions) {
      const oldest = Array.from(this.sessions.entries())
        .filter(([, session]) => !session.hasRetainedView())
        .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0]

      if (!oldest) {
        return
      }

      this.destroySession(oldest[0])
    }
  }
}

export function createMessageListManager<Row, Conversation = MessageListConversationId>(
  options: MessageListManagerOptions<Row, Conversation>,
): MessageListManager<Row> {
  return new ApplicationMessageListManager<Row, Conversation>(options)
}

function normalizeDefaults(
  defaults: MessageListManagerOptions<unknown>['defaults'],
): NormalizedDefaults {
  return {
    pageSize: defaults?.pageSize ?? DEFAULT_PAGE_SIZE,
    maxItems: defaults?.maxItems ?? DEFAULT_MAX_ITEMS,
    keepAlive: {
      maxSessions: defaults?.keepAlive?.maxSessions ?? DEFAULT_MAX_SESSIONS,
      ttlMs: defaults?.keepAlive?.ttlMs ?? DEFAULT_TTL_MS,
    },
  }
}
