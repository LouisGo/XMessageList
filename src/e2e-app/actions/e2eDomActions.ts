export class E2EActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function scrollContainer(
  root: HTMLElement | null,
  target: 'top' | 'middle' | 'bottom',
): void {
  const container = findScrollContainer(root)
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const nextTop = target === 'top'
    ? 0
    : target === 'bottom'
      ? maxTop
      : maxTop / 2

  container.scrollTop = nextTop
  container.dispatchEvent(new Event('scroll', { bubbles: true }))
}

/**
 * A reload cancellation test must cross the runtime's wheel/touch user-input
 * gate; setting scrollTop alone can be suppressed as a programmatic write.
 */
export function scrollContainerAsUser(
  root: HTMLElement | null,
  target: 'top' | 'middle' | 'bottom',
): void {
  const container = findScrollContainer(root)
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const nextTop = target === 'top'
    ? 0
    : target === 'bottom'
      ? maxTop
      : maxTop / 2
  container.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: nextTop - container.scrollTop,
  }))
  container.scrollTop = nextTop
  container.dispatchEvent(new Event('scroll', { bubbles: true }))
}

export function dragScrollbarToTop(root: HTMLElement | null): void {
  const thumb = root?.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')

  if (!thumb) {
    throw new E2EActionError('missing_scrollbar_thumb', 'scrollbar thumb not found')
  }

  const rect = thumb.getBoundingClientRect()
  dispatchPointer(thumb, 'pointerdown', rect.left + rect.width / 2, rect.top + rect.height / 2)
  dispatchPointer(thumb, 'pointermove', rect.left + rect.width / 2, 0)
  dispatchPointer(thumb, 'pointerup', rect.left + rect.width / 2, 0)
}

export function holdScrollbarAtTop(root: HTMLElement | null): void {
  const thumb = root?.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')
  const track = root?.querySelector<HTMLElement>('[data-message-scrollbar-track]')

  if (!thumb || !track) {
    throw new E2EActionError('missing_scrollbar_thumb', 'scrollbar thumb not found')
  }

  const thumbRect = thumb.getBoundingClientRect()
  const trackRect = track.getBoundingClientRect()
  const x = thumbRect.left + thumbRect.width / 2
  const y = trackRect.top

  dispatchPointer(thumb, 'pointerdown', x, thumbRect.top + thumbRect.height / 2)
  dispatchPointer(thumb, 'pointermove', x, y)
  heldScrollbarDrag = { target: thumb, x, y }
}

export function continueHeldScrollbarToTop(root: HTMLElement | null): void {
  if (!heldScrollbarDrag) {
    throw new E2EActionError('missing_held_scrollbar_drag', 'held scrollbar drag not active')
  }

  const track = root?.querySelector<HTMLElement>('[data-message-scrollbar-track]')
  const trackTop = track?.getBoundingClientRect().top ?? heldScrollbarDrag.y
  const y = trackTop - 32

  dispatchPointer(heldScrollbarDrag.target, 'pointermove', heldScrollbarDrag.x, y)
  heldScrollbarDrag = { ...heldScrollbarDrag, y }
}

export function releaseHeldScrollbar(): void {
  if (!heldScrollbarDrag) {
    return
  }

  dispatchPointer(
    heldScrollbarDrag.target,
    'pointerup',
    heldScrollbarDrag.x,
    heldScrollbarDrag.y,
  )
  heldScrollbarDrag = null
}

export function dragScrollbarToBottom(root: HTMLElement | null): void {
  const thumb = root?.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')
  const track = root?.querySelector<HTMLElement>('[data-message-scrollbar-track]')

  if (!thumb || !track) {
    throw new E2EActionError('missing_scrollbar_thumb', 'scrollbar thumb not found')
  }

  const thumbRect = thumb.getBoundingClientRect()
  const trackRect = track.getBoundingClientRect()
  const x = thumbRect.left + thumbRect.width / 2
  const y = trackRect.bottom

  dispatchPointer(thumb, 'pointerdown', x, thumbRect.top + thumbRect.height / 2)
  dispatchPointer(thumb, 'pointermove', x, y)
  dispatchPointer(thumb, 'pointerup', x, y)
}

export function clickScrollbarTrack(root: HTMLElement | null, ratio: number): void {
  const track = root?.querySelector<HTMLElement>('[data-message-scrollbar-track]')

  if (!track) {
    throw new E2EActionError('missing_scrollbar_track', 'scrollbar track not found')
  }

  const rect = track.getBoundingClientRect()
  dispatchPointer(
    track,
    'pointerdown',
    rect.left + rect.width / 2,
    rect.top + rect.height * Math.min(Math.max(ratio, 0), 1),
  )
}

function findScrollContainer(root: HTMLElement | null): HTMLElement {
  const container = root?.querySelector<HTMLElement>('[data-message-scroll-container]')

  if (!container) {
    throw new E2EActionError('missing_scroll_container', 'scroll container not found')
  }

  return container
}

let heldScrollbarDrag: {
  target: HTMLElement
  x: number
  y: number
} | null = null

function dispatchPointer(
  target: HTMLElement,
  type: string,
  clientX: number,
  clientY: number,
): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'mouse',
  }))
}
