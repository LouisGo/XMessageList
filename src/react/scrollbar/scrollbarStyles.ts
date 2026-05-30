import { MIN_THUMB_SIZE } from './scrollbarGeometry'

export const overlayStyle = {
  bottom: 0,
  pointerEvents: 'none',
  position: 'absolute',
  right: 6,
  top: 0,
  width: 12,
  zIndex: 4,
} as const

export const trackStyle = {
  height: '100%',
  pointerEvents: 'auto',
  position: 'relative',
  width: '100%',
} as const

export const thumbStyle = {
  background: 'rgb(45 65 72 / 0.46)',
  border: '2px solid rgb(255 255 255 / 0.7)',
  borderRadius: 999,
  boxSizing: 'border-box',
  minHeight: MIN_THUMB_SIZE,
  position: 'absolute',
  right: 0,
  top: 0,
  width: 12,
} as const
