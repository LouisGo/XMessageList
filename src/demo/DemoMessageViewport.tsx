import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  MessageViewport,
  MessageViewportRuntime,
  type MessageDataItem,
} from '../index'
import {
  type DemoMessage,
  createDemoSnapshot,
  createNewestMessage,
  createOutgoingMessage,
  createOlderMessages,
  createDemoMessages,
} from './demoData'

const HISTORY_BATCH_SIZE = 20
const INITIAL_MESSAGES = createDemoMessages(80)

export function DemoMessageViewport() {
  const runtime = useMemo(
    () =>
      new MessageViewportRuntime<DemoMessage>({
        feedId: 'demo-feed',
        generation: 1,
        window: {
          minMountedItems: 60,
          maxMountedItems: 180,
          defaultItemHeight: 104,
        },
        bottomUnlockThresholdPx: 200,
        edgeLoadThresholdPx: 72,
      }),
    [],
  )
  const messagesRef = useRef(INITIAL_MESSAGES)
  const revisionRef = useRef(1)
  const loadingBeforeRef = useRef(false)
  const destroyTimerRef = useRef<number | null>(null)
  const [messageCount, setMessageCount] = useState(INITIAL_MESSAGES.length)
  const [loadingBefore, setLoadingBefore] = useState(false)
  const [lastEvent, setLastEvent] = useState('bootstrap latest')
  const [draft, setDraft] = useState('')

  const publishMessages = useCallback((
    effect: Parameters<typeof createDemoSnapshot>[0]['effect'],
    kind: Parameters<typeof createDemoSnapshot>[0]['kind'],
  ) => {
    revisionRef.current += 1
    setMessageCount(messagesRef.current.length)
    runtime.setDataSnapshot(
      createDemoSnapshot({
        messages: messagesRef.current,
        revision: revisionRef.current,
        effect,
        kind,
        hasMoreBefore: true,
      }),
    )
  }, [runtime])

  const loadHistoryBatch = useCallback(() => {
    if (loadingBeforeRef.current) {
      return
    }

    loadingBeforeRef.current = true
    setLoadingBefore(true)
    setLastEvent('loading history...')

    window.setTimeout(() => {
      messagesRef.current = [
        ...createOlderMessages(HISTORY_BATCH_SIZE),
        ...messagesRef.current,
      ]
      loadingBeforeRef.current = false
      setLoadingBefore(false)
      publishMessages('prepend', 'prepend')
      setLastEvent(`loaded ${HISTORY_BATCH_SIZE} older messages`)
    }, 500)
  }, [publishMessages])

  useEffect(() => {
    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current)
      destroyTimerRef.current = null
    }

    const unsubscribe = runtime.subscribeEvent((event) => {
      setLastEvent(event.type)

      if (event.type === 'needMoreBefore') {
        loadHistoryBatch()
      }
    })

    publishMessages('reset', 'initial')
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })

    return () => {
      unsubscribe()
      // StrictMode 会立即执行一次 cleanup 再重新 setup；destroy 延后一拍并允许下次 setup 取消，
      // 避免把仍会复用的 runtime 置为 DESTROYED，导致 bootstrap 和按钮命令全部 no-op。
      destroyTimerRef.current = window.setTimeout(() => {
        runtime.destroy()
      }, 0)
    }
  }, [loadHistoryBatch, publishMessages, runtime])

  const appendMessage = () => {
    messagesRef.current = [...messagesRef.current, createNewestMessage()]
    publishMessages('append', 'append')
  }

  const appendLongBurst = () => {
    const next = Array.from({ length: 4 }, () => createNewestMessage()).map(
      (message, index) =>
        index === 1
          ? {
              ...message,
              kind: 'longText' as const,
              body: `${message.body} ${message.body} ${message.body}`,
              expanded: true,
            }
          : message,
    )
    messagesRef.current = [...messagesRef.current, ...next]
    publishMessages('append', 'append')
  }

  const toggleDynamicHeight = () => {
    const next = messagesRef.current.map((message, index, list) =>
      index >= list.length - 10
        ? { ...message, expanded: !message.expanded }
        : message,
    )

    messagesRef.current = next
    publishMessages('items-change', 'patch')
  }

  const sendDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = draft.trim()

    if (!body) {
      return
    }

    messagesRef.current = [...messagesRef.current, createOutgoingMessage(body)]
    setDraft('')
    publishMessages('auto-scroll-to-bottom', 'append')
  }

  return (
    <main className="demo-shell">
      <aside className="demo-sidebar" aria-label="Runtime controls">
        <div>
          <p className="eyebrow">XMessageList</p>
          <h1>IM Runtime Demo</h1>
        </div>
        <div className="demo-actions">
          <button
            type="button"
            data-testid="load-history-button"
            onClick={loadHistoryBatch}
          >
            Load 20
          </button>
          <button type="button" data-testid="append-button" onClick={appendMessage}>
            Append
          </button>
          <button
            type="button"
            data-testid="long-burst-button"
            onClick={appendLongBurst}
          >
            Long Burst
          </button>
          <button
            type="button"
            data-testid="resize-messages-button"
            onClick={toggleDynamicHeight}
          >
            Resize
          </button>
          <button
            type="button"
            data-testid="sidebar-bottom-button"
            onClick={() => runtime.dispatch({ type: 'followBottom' })}
          >
            Bottom
          </button>
        </div>
        <dl className="demo-stats">
          <div>
            <dt>Messages</dt>
            <dd>{messageCount}</dd>
          </div>
          <div>
            <dt>History</dt>
            <dd>{loadingBefore ? 'loading' : 'idle'}</dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>{lastEvent}</dd>
          </div>
        </dl>
      </aside>
      <section className="chat-surface" aria-label="Message runtime demo">
        <MessageViewport
          runtime={runtime}
          className="message-viewport"
          renderMessage={renderDemoMessage}
          renderOverlay={(snapshot) => (
            <>
              {loadingBefore ? (
                <div className="history-loading">Loading older messages...</div>
              ) : null}
              {snapshot.bottomLockState === 'UNLOCKED' ? (
                <button
                  type="button"
                  className="follow-bottom-button"
                  aria-label="Follow latest messages"
                  data-testid="follow-bottom-button"
                  onClick={() => runtime.dispatch({ type: 'followBottom' })}
                >
                  Bottom
                </button>
              ) : null}
            </>
          )}
        />
        <form className="message-composer" onSubmit={sendDraft}>
          <textarea
            aria-label="Message input"
            data-testid="message-input"
            value={draft}
            placeholder="Type a message..."
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <button
            type="submit"
            data-testid="send-message-button"
            disabled={draft.trim().length === 0}
          >
            Send
          </button>
        </form>
      </section>
    </main>
  )
}

function renderDemoMessage(item: MessageDataItem<DemoMessage>) {
  if (item.kind === 'tombstone') {
    return <article className="message-row system">Message unavailable</article>
  }

  if (item.kind === 'optimistic') {
    return <article className="message-row system">Sending...</article>
  }

  const message = item.message

  return (
    <article className={`message-row ${message.tone} ${message.kind}`}>
      <header>
        <strong>{message.author}</strong>
        <span>{message.id}</span>
      </header>
      <p>{message.body}</p>
      {message.media ? <MediaBlock message={message} /> : null}
      {message.expanded ? (
        <div className="message-attachment">
          Async content expanded after the row was projected.
        </div>
      ) : null}
    </article>
  )
}

function MediaBlock({ message }: { message: DemoMessage }) {
  if (!message.media) {
    return null
  }

  return (
    <div
      className={`media-block ${message.kind}`}
      style={{ aspectRatio: `${message.media.width} / ${message.media.height}` }}
    >
      <span>{message.media.label}</span>
      {message.kind === 'video' ? <button type="button">Play</button> : null}
    </div>
  )
}
