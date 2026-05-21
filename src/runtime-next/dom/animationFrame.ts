export function getRuntimeAnimationFrame(): {
  readonly request: (callback: FrameRequestCallback) => number
  readonly cancel: (handle: number) => void
} {
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    return {
      request: window.requestAnimationFrame.bind(window),
      cancel: window.cancelAnimationFrame.bind(window),
    }
  }

  return {
    request: (callback) =>
      globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number,
    cancel: (handle) => globalThis.clearTimeout(handle),
  }
}
