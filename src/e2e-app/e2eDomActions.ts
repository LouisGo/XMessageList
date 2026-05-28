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
