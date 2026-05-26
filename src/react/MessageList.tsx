import { useCallback, useRef } from 'react'
import { useMessageListSnapshot } from './hooks'
import type { MessageListProps } from './types'

export function MessageList<TMessage, TOptimistic>({
  runtime,
  className,
  style,
  renderOverlay,
}: MessageListProps<TMessage, TOptimistic>) {
  const snapshot = useMessageListSnapshot(runtime)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const attachContainer = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element
    if (element) {
      runtime.attachScrollContainer(element)
      return
    }

    runtime.detachScrollContainer()
  }, [runtime])

  return (
    <div
      data-message-list
      className={className}
      style={style}
    >
      <div
        ref={attachContainer}
        data-message-scroll-container
      >
        {renderOverlay?.({ snapshot })}
      </div>
    </div>
  )
}
