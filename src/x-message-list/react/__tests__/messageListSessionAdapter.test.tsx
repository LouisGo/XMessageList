import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import {
  createMessageListSessionRegistry,
  type MessageListAdapter,
  type MessageListPage,
} from '../../core/session-registry/index'
import { MessageList } from '../components/MessageList'
import { MessageListSessionRegistryProvider } from '../components/MessageListSessionRegistryProvider'
import { useMessageListSession } from '../hooks/useMessageListSession'

describe('MessageList session adapter', () => {
  it('resolves a session from provider and keeps the session after unmount', async () => {
    const registry = createMessageListSessionRegistry<string>({
      getAdapter: () => createStringAdapter(['row-a']),
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    function ConversationView() {
      const session = useMessageListSession<string>('feed-a')

      return (
        <MessageList
          session={session}
          renderRow={({ row }) => <span>{row}</span>}
          renderBeforeStatus={() => <span data-slot="before">Before</span>}
          renderAfterStatus={() => <span data-slot="after">After</span>}
          renderTopPlaceholder={() => <div data-slot="top">Top</div>}
          renderOverlayStatus={({ status }) => (
            <div data-slot="overlay">{status}</div>
          )}
        />
      )
    }

    await act(async () => {
      root.render(
        <MessageListSessionRegistryProvider registry={registry}>
          <ConversationView />
        </MessageListSessionRegistryProvider>,
      )
    })
    await waitFor(() => host.textContent?.includes('row-a') ?? false)

    const before = host.querySelector('[data-edge-trigger="before"]')
    const top = host.querySelector('[data-message-top-placeholder]')
    const row = host.querySelector('[data-message-row]')
    const after = host.querySelector('[data-edge-trigger="after"]')

    expect(host.querySelector('[data-message-flow]')).not.toBeNull()
    expect(before?.compareDocumentPosition(top as Node))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(top?.compareDocumentPosition(row as Node))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(row?.compareDocumentPosition(after as Node))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(host.querySelector('[data-message-list-overlay-layer]')).not.toBeNull()

    await act(async () => {
      root.unmount()
    })

    expect(registry.hasSession('feed-a')).toBe(true)
    registry.destroyAll()
  })

  it('renders empty state with session reload command', async () => {
    const pages: string[][] = [[], ['row-a']]
    const registry = createMessageListSessionRegistry<string>({
      getAdapter: () => createStringAdapter([], {
        loadLatest: () => Promise.resolve(page(pages.shift() ?? [])),
      }),
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    function ConversationView() {
      const session = useMessageListSession<string>('feed-a')

      return (
        <MessageList
          session={session}
          renderRow={({ row }) => <span>{row}</span>}
          renderEmpty={({ reload }) => (
            <button type="button" onClick={reload}>Reload</button>
          )}
        />
      )
    }

    await act(async () => {
      root.render(
        <MessageListSessionRegistryProvider registry={registry}>
          <ConversationView />
        </MessageListSessionRegistryProvider>,
      )
    })
    await waitFor(() => host.querySelector('button') !== null)

    await act(async () => {
      host.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    await waitFor(() => host.textContent?.includes('row-a') ?? false)

    await act(async () => {
      root.unmount()
    })
    registry.destroyAll()
  })

  it('does not evict a mounted session while applying keepAlive capacity', async () => {
    const registry = createMessageListSessionRegistry<string>({
      defaults: {
        keepAlive: {
          maxSessions: 1,
          ttlMs: 10 * 60_000,
        },
      },
      getAdapter: () => createStringAdapter(['row-a']),
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    function ConversationView() {
      const session = useMessageListSession<string>('feed-a')

      return (
        <MessageList
          session={session}
          renderRow={({ row }) => <span>{row}</span>}
        />
      )
    }

    await act(async () => {
      root.render(
        <MessageListSessionRegistryProvider registry={registry}>
          <ConversationView />
        </MessageListSessionRegistryProvider>,
      )
    })
    await waitFor(() => registry.hasSession('feed-a'))

    registry.getSession('feed-b')

    expect(registry.hasSession('feed-a')).toBe(true)

    await act(async () => {
      root.unmount()
    })

    registry.getSession('feed-c')

    expect(registry.hasSession('feed-a')).toBe(false)
    expect(registry.hasSession('feed-c')).toBe(true)
    registry.destroyAll()
  })
})

function createStringAdapter(
  latestRows: string[],
  overrides: Partial<MessageListAdapter<string>['request']> = {},
): MessageListAdapter<string> {
  return {
    row: {
      getKey: (row) => row,
      getAnchor: (row) => ({ id: row }),
    },
    request: {
      loadLatest: overrides.loadLatest ?? (() => Promise.resolve(page(latestRows))),
      loadBefore: overrides.loadBefore ?? (() => Promise.resolve(page([]))),
      loadAfter: overrides.loadAfter ?? (() => Promise.resolve(page([]))),
      loadAround: overrides.loadAround ?? (() => Promise.resolve(page(latestRows))),
    },
  }
}

function page(rows: string[]): MessageListPage<string> {
  return {
    rows,
    hasMoreBefore: false,
    hasMoreAfter: false,
    anchor: rows.at(-1) ? { id: rows.at(-1) } : undefined,
  }
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return
    }

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
  }

  expect(condition()).toBe(true)
}
