import {
  type FormEvent,
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
import { type DemoMessage } from './demoData'
import { DEMO_FEEDS } from './demoFeeds'
import { useDemoMessageScenario } from './useDemoMessageScenario'

export function DemoMessageViewport() {
  const runtime = useMemo(
    () =>
      new MessageViewportRuntime<DemoMessage>({
        feedId: DEMO_FEEDS[0]?.id ?? 'feed-runtime',
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
  const scenario = useDemoMessageScenario(runtime)
  const destroyTimerRef = useRef<number | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current)
      destroyTimerRef.current = null
    }

    return () => {
      // StrictMode 会立即执行一次 cleanup 再重新 setup；destroy 延后一拍并允许下次 setup 取消，
      // 避免把仍会复用的 runtime 置为 DESTROYED，导致 bootstrap 和按钮命令全部 no-op。
      destroyTimerRef.current = window.setTimeout(() => {
        runtime.destroy()
      }, 0)
    }
  }, [runtime])

  const sendDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (scenario.sendMessage(draft)) {
      setDraft('')
    }
  }

  const renderDemoItem = (item: MessageDataItem<DemoMessage>) => {
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
          <div className="message-row-meta">
            <span>{message.id}</span>
            <div className="message-row-actions">
              {message.tone === 'self' ? (
                <button
                  type="button"
                  className="message-row-action"
                  data-testid={`edit-message-${message.id}`}
                  onClick={() => {
                    const nextBody = window.prompt('Edit message', message.body)

                    if (typeof nextBody === 'string') {
                      scenario.editMessage(message.id, nextBody)
                    }
                  }}
                >
                  Edit
                </button>
              ) : null}
              <button
                type="button"
                className="message-row-action"
                data-testid={`react-message-${message.id}`}
                onClick={() => scenario.reactToMessage(message.id)}
              >
                React
              </button>
              <button
                type="button"
                className="message-row-action danger"
                data-testid={`delete-message-${message.id}`}
                onClick={() => scenario.deleteMessage(message.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </header>
        <p>{message.body}</p>
        {message.media ? <MediaBlock message={message} /> : null}
        {message.expanded ? (
          <div className="message-attachment">
            Async content expanded after the row was projected.
          </div>
        ) : null}
        {message.reactions.length > 0 ? (
          <div className="message-reactions" aria-label="Reactions">
            {message.reactions.map((reaction, index) => (
              <span
                key={`${message.id}-reaction-${index}`}
                className="message-reaction-chip"
              >
                {reaction}
              </span>
            ))}
          </div>
        ) : null}
        {message.editedAt ? (
          <div className="message-edited-flag">(edited)</div>
        ) : null}
      </article>
    )
  }

  return (
    <main className="demo-shell">
      <aside className="demo-sidebar" aria-label="Runtime controls">
        <div>
          <p className="eyebrow">XMessageList</p>
          <h1>IM Runtime Demo</h1>
          <p className="active-feed-title">{scenario.activeFeed.title}</p>
        </div>
        <div className="demo-actions">
          <button
            type="button"
            data-testid="load-history-button"
            disabled={scenario.feedLoading}
            onClick={() => scenario.loadHistoryBatch('manual')}
          >
            Load 20
          </button>
          <button
            type="button"
            data-testid="append-button"
            disabled={scenario.feedLoading}
            onClick={scenario.appendMessage}
          >
            Append
          </button>
          <button
            type="button"
            data-testid="long-burst-button"
            disabled={scenario.feedLoading}
            onClick={scenario.appendLongBurst}
          >
            Long Burst
          </button>
          <button
            type="button"
            data-testid="resize-messages-button"
            disabled={scenario.feedLoading}
            onClick={scenario.toggleDynamicHeight}
          >
            Resize
          </button>
          <button
            type="button"
            data-testid="sidebar-bottom-button"
            disabled={scenario.feedLoading}
            onClick={() => scenario.followBottom('sidebar')}
          >
            Bottom
          </button>
        </div>
        <dl className="demo-stats">
          <div>
            <dt>Messages</dt>
            <dd>{scenario.messageCount}</dd>
          </div>
          <div>
            <dt>Loaded</dt>
            <dd>{scenario.loadedMessageCount}</dd>
          </div>
          <div>
            <dt>History</dt>
            <dd>{scenario.loadingBefore ? 'loading' : 'idle'}</dd>
          </div>
          <div>
            <dt>Feed</dt>
            <dd>{scenario.feedLoading ? 'loading' : 'ready'}</dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd>{scenario.pendingOperation}</dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>{scenario.lastEvent}</dd>
          </div>
        </dl>
        <section className="feed-list" aria-label="Conversations">
          <h2>Feeds</h2>
          {scenario.feeds.map((feed) => (
            <div
              key={feed.id}
              className={`feed-item ${
                feed.id === scenario.activeFeedId ? 'active' : ''
              }`}
            >
              <button
                type="button"
                className="feed-select-button"
                data-testid={`feed-button-${feed.id}`}
                onClick={() => scenario.selectFeed(feed.id)}
              >
                <span>
                  <strong>{feed.title}</strong>
                  <small>{feed.subtitle}</small>
                </span>
                {feed.unread > 0 ? <em>{feed.unread}</em> : null}
              </button>
              <button
                type="button"
                className="feed-clear-button"
                aria-label={`Clear ${feed.title}`}
                data-testid={`clear-feed-button-${feed.id}`}
                disabled={scenario.feedLoading}
                onClick={() => scenario.clearFeed(feed.id)}
              >
                Clear
              </button>
            </div>
          ))}
        </section>
      </aside>
        <section className="chat-surface" aria-label="Message runtime demo">
          <MessageViewport
            runtime={runtime}
            className="message-viewport"
            renderMessage={renderDemoItem}
            renderTopEdge={() =>
              scenario.loadingBefore ? (
                <div className="history-loading">Loading older messages...</div>
              ) : null
            }
            renderFollowBottom={() => (
              <button
                type="button"
                className="follow-bottom-button"
                aria-label="Follow latest messages"
                data-testid="follow-bottom-button"
                onClick={() => scenario.followBottom('floating')}
              >
                Bottom
              </button>
            )}
            onViewportAnchorChange={scenario.rememberRuntimeViewportAnchor}
          />
        <form className="message-composer" onSubmit={sendDraft}>
          <textarea
            aria-label="Message input"
            data-testid="message-input"
            value={draft}
            placeholder="Type a message..."
            rows={1}
            disabled={scenario.feedLoading}
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
            disabled={scenario.feedLoading || draft.trim().length === 0}
          >
            Send
          </button>
        </form>
      </section>
    </main>
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
