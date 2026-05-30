import {
  type FormEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useState,
} from 'react'
import { MessageList, type MessageDataItem } from '../../index'
import type { DemoMessage } from '../data/demoData'
import { useDemoFeedRuntimeCache } from '../runtime/useDemoFeedRuntimeCache'
import {
  type DemoMessageScenario,
  useDemoMessageScenario,
} from '../scenario/useDemoMessageScenario'

export function DemoMessageList() {
  const runtimeCache = useDemoFeedRuntimeCache()
  const scenario = useDemoMessageScenario(runtimeCache)

  return <DemoMessageListContent scenario={scenario} />
}

export type DemoMessageListContentProps = {
  scenario: DemoMessageScenario
  rootRef?: Ref<HTMLElement>
  e2e?: {
    statusRegion: ReactNode
    onResetScenario: () => void
    viewportRemountKey?: number
  }
}

export function DemoMessageListContent({
  scenario,
  rootRef,
  e2e,
}: DemoMessageListContentProps) {
  const [draft, setDraft] = useState('')
  const e2eEnabled = Boolean(e2e)
  const {
    deleteMessage,
    editMessage,
    highlightedMessageId,
    highlightToken,
    jumpToQuote,
    reactToMessage,
  } = scenario

  const renderDemoItem = useCallback((item: MessageDataItem<DemoMessage>) => {
    const message = item.message

    if (!message) {
      return (
        <article className="message-row system">
          Pending row
        </article>
      )
    }

    const quote = message.quote
    const isHighlighted = highlightedMessageId === message.id
    const jumpToMessageQuote = () => {
      if (!quote) {
        return
      }

      jumpToQuote({
        origin: {
          messageId: message.id,
          position: message.sequence,
        },
        target: {
          messageId: quote.messageId,
          position: quote.position,
        },
      })
    }
    const handleQuotePointerDown = (
      event: PointerEvent<HTMLButtonElement>,
    ) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      jumpToMessageQuote()
    }
    const handleQuoteClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail !== 0) {
        return
      }

      jumpToMessageQuote()
    }

    return (
      <article
        key={isHighlighted ? `highlight-${highlightToken}` : 'normal'}
        className={[
          'message-row',
          message.tone,
          message.kind,
          isHighlighted ? 'jump-highlight' : '',
        ].filter(Boolean).join(' ')}
      >
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
                      editMessage(message.id, nextBody)
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
                onClick={() => reactToMessage(message.id)}
              >
                React
              </button>
              <button
                type="button"
                className="message-row-action danger"
                data-testid={`delete-message-${message.id}`}
                onClick={() => deleteMessage(message.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </header>
        {quote ? (
          <button
            type="button"
            className="message-quote"
            data-testid={`quote-jump-${message.id}`}
            data-ai-action={e2eEnabled ? 'jump-to-quote' : undefined}
            onPointerDown={handleQuotePointerDown}
            onClick={handleQuoteClick}
          >
            <strong>{quote.author}</strong>
            <span>{quote.bodyPreview}</span>
          </button>
        ) : null}
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
  }, [
    deleteMessage,
    editMessage,
    e2eEnabled,
    highlightedMessageId,
    highlightToken,
    jumpToQuote,
    reactToMessage,
  ])

  const sendDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (scenario.sendMessage(draft)) {
      setDraft('')
    }
  }

  return (
    <main
      ref={rootRef}
      className={['demo-shell', e2eEnabled ? 'e2e-shell' : '']
        .filter(Boolean)
        .join(' ')}
      data-testid={e2eEnabled ? 'e2e-scenario-host' : undefined}
    >
      <aside className="demo-sidebar" aria-label="Runtime controls">
        <div>
          <p className="eyebrow">XMessageList</p>
          <h1>IM Runtime Demo</h1>
          <p className="active-feed-title">{scenario.activeFeed.title}</p>
        </div>
        {e2e?.statusRegion}
        <div className="demo-actions">
          {e2e ? (
            <button
              type="button"
              data-testid="e2e-reset-button"
              data-ai-action="reset-scenario"
              onClick={e2e.onResetScenario}
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            data-testid="load-history-button"
            disabled={scenario.feedLoading}
            onClick={scenario.loadHistoryBatch}
          >
            Load 20
          </button>
          <button
            type="button"
            data-testid="load-future-button"
            disabled={scenario.feedLoading || !scenario.hasMoreAfter}
            onClick={scenario.loadFutureBatch}
          >
            Newer
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
            className={[
              'advanced-mock-action',
              scenario.eventStormRunning ? 'active' : '',
            ].filter(Boolean).join(' ')}
            data-testid="event-storm-button"
            disabled={scenario.feedLoading && !scenario.eventStormRunning}
            onClick={scenario.toggleEventStorm}
          >
            {scenario.eventStormRunning ? 'Stop Storm' : 'Event Storm'}
          </button>
          <button
            type="button"
            className={[
              'advanced-mock-action',
              scenario.botPushActive ? 'active' : '',
            ].filter(Boolean).join(' ')}
            data-testid="bot-push-button"
            disabled={scenario.feedLoading && !scenario.botPushActive}
            onClick={scenario.toggleBotPush}
          >
            {scenario.botPushActive ? 'Stop Bot' : 'Bot Push'}
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
            data-testid="stream-row-button"
            disabled={scenario.feedLoading}
            onClick={scenario.streamCurrentRow}
          >
            Stream Row
          </button>
          <button
            type="button"
            data-testid="optimistic-send-button"
            disabled={scenario.feedLoading}
            onClick={scenario.sendOptimisticMessage}
          >
            Optimistic
          </button>
          <button
            type="button"
            data-testid="resolve-remap-button"
            disabled={scenario.feedLoading}
            onClick={scenario.resolveOptimisticRemap}
          >
            Resolve
          </button>
          <button
            type="button"
            data-testid="sidebar-bottom-button"
            disabled={scenario.feedLoading}
            onClick={scenario.followBottom}
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
              className={[
                'feed-item',
                feed.id === scenario.activeFeedId ? 'active' : '',
                feed.id === scenario.selectedFeedId &&
                feed.id !== scenario.activeFeedId
                  ? 'selected'
                  : '',
                feed.id === scenario.pendingFeedId ? 'pending' : '',
              ].filter(Boolean).join(' ')}
            >
              <button
                type="button"
                className="feed-select-button"
                aria-current={feed.id === scenario.activeFeedId ? 'true' : undefined}
                aria-busy={feed.id === scenario.pendingFeedId ? true : undefined}
                data-testid={`feed-button-${feed.id}`}
                data-feed-id={e2eEnabled ? feed.id : undefined}
                data-ai-action={e2eEnabled ? 'switch-feed' : undefined}
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
      <section
        className="chat-surface"
        aria-label="Message runtime demo"
        data-feed-id={scenario.activeFeedId}
      >
        <MessageList
          key={e2e?.viewportRemountKey ?? 0}
          runtime={scenario.activeRuntime}
          className={[
            'message-viewport',
            scenario.feedLoading ? 'session-loading' : '',
          ].filter(Boolean).join(' ')}
          renderRow={renderDemoItem}
          renderBeforeEdge={({ status, retry }) =>
            scenario.loadingBefore ? (
              <div className="history-loading">Loading older messages...</div>
            ) : !scenario.feedLoading && status === 'error' ? (
              <button type="button" className="history-loading" onClick={retry}>
                Retry history
              </button>
            ) : null
          }
          renderAfterEdge={({ status, retry }) =>
            scenario.loadingAfter ? (
              <div className="history-loading history-loading-bottom">
                Loading newer messages...
              </div>
            ) : !scenario.feedLoading && status === 'error' ? (
              <button
                type="button"
                className="history-loading history-loading-bottom"
                onClick={retry}
              >
                Retry newer
              </button>
            ) : null
          }
          renderScrollToLatest={({ visible, scrollToLatest }) =>
            visible ? (
              <button
                type="button"
                className="follow-bottom-button"
                aria-label="Follow latest messages"
                data-testid="follow-bottom-button"
                data-ai-action={e2eEnabled ? 'follow-bottom' : undefined}
                onClick={scrollToLatest}
              >
                Bottom
              </button>
            ) : null
          }
          renderOverlay={() =>
            scenario.sessionLoadingOverlayVisible ? (
              <div
                className="session-loading-overlay"
                data-testid="session-loading-overlay"
                role="status"
                aria-label="Loading messages"
              >
                <span
                  className="session-loading-spinner"
                  data-testid="session-loading-spinner"
                  aria-hidden="true"
                />
              </div>
            ) : null
          }
          onViewportAnchorChange={scenario.rememberRuntimeViewportAnchor}
          scrollbar="custom"
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
