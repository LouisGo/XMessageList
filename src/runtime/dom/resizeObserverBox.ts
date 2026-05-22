export function readResizeObserverBoxHeight(
  entry: ResizeObserverEntry,
): number {
  const borderBox = readBoxSize(entry.borderBoxSize)

  if (borderBox > 0) {
    return borderBox
  }

  return readBoxSize(entry.contentBoxSize)
}

function readBoxSize(
  boxSize:
    | ResizeObserverEntry['borderBoxSize']
    | ResizeObserverEntry['contentBoxSize'],
): number {
  const first = Array.isArray(boxSize) ? boxSize[0] : boxSize
  return first?.blockSize ?? 0
}
