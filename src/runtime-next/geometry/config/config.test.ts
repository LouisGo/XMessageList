import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHYSICAL_SEGMENT_CONFIG,
  createPhysicalSegmentId,
  resolvePhysicalSegmentConfig,
} from './config'

describe('physical segment config', () => {
  it('fills the P3.0 defaults without mutating the resolved object shape', () => {
    const resolved = resolvePhysicalSegmentConfig()

    expect(resolved).toEqual(DEFAULT_PHYSICAL_SEGMENT_CONFIG)
    expect(resolved.maxPhysicalScrollHeightPx).toBe(16000)
    expect(resolved.defaultEstimatedRowHeightPx).toBe(64)
    expect(resolved.minimumSafeBufferPx).toBe(160)
    expect(resolved.diagnosticsRetentionStrategy).toBe('ring-buffer')
    expect(resolved.diagnosticsPayloadCompression).toBe('none')
  })

  it('keeps overrides local to the resolved config', () => {
    const resolved = resolvePhysicalSegmentConfig({
      maxPhysicalScrollHeightPx: 24000,
      maxMountedItems: 96,
    })

    expect(resolved.maxPhysicalScrollHeightPx).toBe(24000)
    expect(resolved.maxMountedItems).toBe(96)
    expect(DEFAULT_PHYSICAL_SEGMENT_CONFIG.maxPhysicalScrollHeightPx).toBe(16000)
  })

  it('creates a stable segment id that is not tied to array index', () => {
    expect(
      createPhysicalSegmentId({
        feedId: 'feed',
        generation: 9,
        sequence: 4,
      }),
    ).toBe('feed:g9:physical-segment-4')
  })
})
