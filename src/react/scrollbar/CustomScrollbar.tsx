import { useLayoutEffect, useRef } from 'react'
import type { MessageViewportRuntime } from '../../runtime'
import { CustomScrollbarController } from './customScrollbarController'
import { customScrollbarStyle } from './customScrollbarStyles'

type CustomScrollbarProps<TMessage = unknown, TOptimistic = unknown> = {
  container: HTMLElement | null
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  enabled?: boolean
  geometryVersion?: number
}

type ControllerEntry<TMessage, TOptimistic> = {
  controller: CustomScrollbarController<TMessage, TOptimistic>
  container: HTMLElement
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
}

type StyleEntry = {
  element: HTMLStyleElement
  references: number
}

const styleEntries = new WeakMap<Document, StyleEntry>()

export function CustomScrollbar<TMessage = unknown, TOptimistic = unknown>({
  container,
  runtime,
  enabled = true,
  geometryVersion,
}: CustomScrollbarProps<TMessage, TOptimistic>) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const controllerRef =
    useRef<ControllerEntry<TMessage, TOptimistic> | null>(null)
  const skipNextProjectionSyncRef = useRef(false)

  useLayoutEffect(() => {
    if (!enabled || !container) {
      return
    }

    return retainCustomScrollbarStyle(container.ownerDocument)
  }, [container, enabled])

  useLayoutEffect(() => {
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!enabled || !container || !track || !thumb) {
      controllerRef.current = null
      skipNextProjectionSyncRef.current = false
      return
    }

    const controller = new CustomScrollbarController({
      container,
      track,
      thumb,
      runtime,
    })
    controllerRef.current = {
      controller,
      container,
      runtime,
    }
    controller.attach()
    skipNextProjectionSyncRef.current = true

    return () => {
      controller.destroy()
      if (controllerRef.current?.controller === controller) {
        controllerRef.current = null
      }
      skipNextProjectionSyncRef.current = false
    }
  }, [container, enabled, runtime])

  useLayoutEffect(() => {
    const entry = controllerRef.current
    if (!enabled || entry?.container !== container || entry.runtime !== runtime) {
      return
    }

    if (skipNextProjectionSyncRef.current) {
      skipNextProjectionSyncRef.current = false
      return
    }

    entry.controller.syncFromProjection()
  }, [container, enabled, geometryVersion, runtime])

  if (!enabled || !container) {
    return null
  }

  return (
    <div
      ref={trackRef}
      aria-hidden="true"
      className="x-message-scrollbar"
      data-testid="custom-scrollbar"
    >
      <div
        ref={thumbRef}
        className="x-message-scrollbar-thumb"
        data-testid="custom-scrollbar-thumb"
      />
    </div>
  )
}

function retainCustomScrollbarStyle(ownerDocument: Document): () => void {
  const current = styleEntries.get(ownerDocument)

  if (current) {
    current.references += 1
    return () => {
      releaseCustomScrollbarStyle(ownerDocument)
    }
  }

  const element = ownerDocument.createElement('style')
  element.textContent = customScrollbarStyle
  ownerDocument.head.appendChild(element)
  styleEntries.set(ownerDocument, {
    element,
    references: 1,
  })

  return () => {
    releaseCustomScrollbarStyle(ownerDocument)
  }
}

function releaseCustomScrollbarStyle(ownerDocument: Document): void {
  const current = styleEntries.get(ownerDocument)

  if (!current) {
    return
  }

  current.references -= 1

  if (current.references > 0) {
    return
  }

  current.element.remove()
  styleEntries.delete(ownerDocument)
}
