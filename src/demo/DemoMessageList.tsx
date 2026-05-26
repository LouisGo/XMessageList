import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useState,
} from 'react'
import { MessageList, type MessageDataItem } from '../index'
import type { DemoMessage } from './demoData'
import { useDemoFeedRuntimeCache } from './useDemoFeedRuntimeCache'
import {
  type DemoMessageScenario,
  useDemoMessageScenario,
} from './useDemoMessageScenario'

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
  const renderDemoItem = useCallback((item: MessageDataItem<DemoMessage>) => {
    const message = item.message
    return (
      <article className={['message-row', message?.tone ?? 'system'].join(' ')}>
        <header>
          <strong>{message?.author ?? 'System'}</strong>
          <span>{message?.id ?? item.key}</span>
        </header>
        <p>{message?.body ?? 'Pending row'}</p>
      </article>
    )
  }, [])

  const sendDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (scenario.sendMessage(draft)) {
      setDraft('')
    }
  }

  return (
    <main
      ref={rootRef}
      className={['demo-shell', e2e ? 'e2e-shell' : ''].filter(Boolean).join(' ')}
      data-testid={e2e ? 'e2e-scenario-host' : undefined}
    >
      <aside className="demo-sidebar" aria-label="Runtime controls">
        <div>
          <p className="eyebrow">XMessageList</p>
          <h1>MessageList Demo</h1>
          <p className="active-feed-title">{scenario.activeFeed.title}</p>
        </div>
        {e2e?.statusRegion}
        <div className="demo-actions">
          {e2e ? (
            <button type="button" onClick={e2e.onResetScenario}>
              Reset
            </button>
          ) : null}
          <button type="button" onClick={scenario.appendMessage}>
            Append
          </button>
          <button type="button" onClick={scenario.followBottom}>
            Latest
          </button>
        </div>
        <dl className="demo-stats">
          <div>
            <dt>Loaded</dt>
            <dd>{scenario.loadedMessageCount}</dd>
          </div>
          <div>
            <dt>Status</dt>
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
              ].filter(Boolean).join(' ')}
            >
              <button
                type="button"
                className="feed-select-button"
                onClick={() => scenario.selectFeed(feed.id)}
              >
                <span>
                  <strong>{feed.title}</strong>
                  <small>{feed.subtitle}</small>
                </span>
              </button>
            </div>
          ))}
        </section>
      </aside>
      <section className="chat-surface" aria-label="Message runtime demo">
        <MessageList
          key={e2e?.viewportRemountKey ?? 0}
          runtime={scenario.activeRuntime}
          className="message-viewport"
          renderRow={renderDemoItem}
          renderBeforeEdge={() => null}
          renderAfterEdge={() => null}
          onViewportAnchorChange={scenario.rememberRuntimeViewportAnchor}
        />
        <form className="message-composer" onSubmit={sendDraft}>
          <textarea
            aria-label="Message input"
            value={draft}
            placeholder="Type a message..."
            rows={1}
            disabled={scenario.feedLoading}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </section>
    </main>
  )
}
