import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageViewport,
  MessageViewportRuntime,
  type MessageDataItem,
} from '../index'
import {
  type DemoMessage,
  createDemoMessage,
  createDemoMessages,
  createDemoSnapshot,
  createOlderMessages,
} from './demoData'

const INITIAL_MESSAGES = createDemoMessages(96)

export function DemoMessageViewport() {
  const runtime = useMemo(
    () =>
      new MessageViewportRuntime<DemoMessage>({
        feedId: 'demo-feed',
        generation: 1,
        window: {
          minMountedItems: 80,
          maxMountedItems: 220,
          defaultItemHeight: 82,
        },
      }),
    [],
  )
  const messagesRef = useRef(INITIAL_MESSAGES)
  const revisionRef = useRef(1)
  const [messageCount, setMessageCount] = useState(INITIAL_MESSAGES.length)
  const [lastEvent, setLastEvent] = useState('ready')

  useEffect(() => {
    const unsubscribe = runtime.subscribeEvent((event) => {
      setLastEvent(event.type)
    })

    runtime.setDataSnapshot(
      createDemoSnapshot({
        messages: messagesRef.current,
        revision: revisionRef.current,
        effect: 'reset',
        kind: 'initial',
      }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })

    return () => {
      unsubscribe()
      runtime.destroy()
    }
  }, [runtime])

  const publishMessages = (
    messages: DemoMessage[],
    effect: Parameters<typeof createDemoSnapshot>[0]['effect'],
    kind: Parameters<typeof createDemoSnapshot>[0]['kind'],
  ) => {
    messagesRef.current = messages
    revisionRef.current += 1
    setMessageCount(messages.length)
    runtime.setDataSnapshot(
      createDemoSnapshot({
        messages,
        revision: revisionRef.current,
        effect,
        kind,
      }),
    )
  }

  const prependHistory = () => {
    publishMessages(
      [...createOlderMessages(24), ...messagesRef.current],
      'prepend',
      'prepend',
    )
  }

  const appendMessage = () => {
    publishMessages(
      [...messagesRef.current, createDemoMessage()],
      'append',
      'append',
    )
  }

  const toggleDynamicHeight = () => {
    const next = messagesRef.current.map((message, index, list) =>
      index >= list.length - 6
        ? { ...message, expanded: !message.expanded }
        : message,
    )

    publishMessages(next, 'items-change', 'patch')
  }

  return (
    <main className="demo-shell">
      <aside className="demo-sidebar" aria-label="Runtime controls">
        <div>
          <p className="eyebrow">XMessageList</p>
          <h1>Viewport Runtime</h1>
        </div>
        <div className="demo-actions">
          <button type="button" onClick={prependHistory}>
            Prepend
          </button>
          <button type="button" onClick={appendMessage}>
            Append
          </button>
          <button type="button" onClick={toggleDynamicHeight}>
            Resize
          </button>
          <button
            type="button"
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
        />
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
    <article className={`message-row ${message.tone}`}>
      <header>
        <strong>{message.author}</strong>
        <span>{message.id}</span>
      </header>
      <p>{message.text}</p>
      {message.expanded ? (
        <div className="message-attachment">
          Dynamic content changed this row height after projection commit.
        </div>
      ) : null}
    </article>
  )
}
