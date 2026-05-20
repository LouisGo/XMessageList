import type {
  RuntimeNextFeedId,
  RuntimeNextGeneration,
} from '../../identity/types'

export type PhysicalSegmentConfig = {
  readonly maxPhysicalScrollHeightPx?: number
  readonly maxPhysicalViewportMultiplier?: number
  readonly segmentShiftThresholdViewportMultiplier?: number
  readonly minRealRowCoverageViewportMultiplier?: number
  readonly defaultEstimatedRowHeightPx?: number
  readonly maxMountedItems?: number
  readonly minimumSafeBufferPx?: number
  readonly diagnosticsRetentionStrategy?: GeometryDiagnosticsRetentionStrategy
  readonly diagnosticsRingBufferSize?: number
  readonly diagnosticsPayloadCompression?: GeometryDiagnosticsPayloadCompression
  readonly devHighFrequencyDiagnostics?: boolean
}

export type ResolvedPhysicalSegmentConfig = Required<PhysicalSegmentConfig>
export type GeometryDiagnosticsRetentionStrategy = 'ring-buffer'
export type GeometryDiagnosticsPayloadCompression = 'none'

export const DEFAULT_PHYSICAL_SEGMENT_CONFIG = {
  maxPhysicalScrollHeightPx: 16000,
  maxPhysicalViewportMultiplier: 5,
  segmentShiftThresholdViewportMultiplier: 1.5,
  minRealRowCoverageViewportMultiplier: 1,
  defaultEstimatedRowHeightPx: 64,
  maxMountedItems: 120,
  minimumSafeBufferPx: 160,
  diagnosticsRetentionStrategy: 'ring-buffer',
  diagnosticsRingBufferSize: 120,
  diagnosticsPayloadCompression: 'none',
  devHighFrequencyDiagnostics: false,
} satisfies ResolvedPhysicalSegmentConfig

export function resolvePhysicalSegmentConfig(
  config: PhysicalSegmentConfig = {},
): ResolvedPhysicalSegmentConfig {
  return {
    ...DEFAULT_PHYSICAL_SEGMENT_CONFIG,
    ...config,
  }
}

export function createPhysicalSegmentId(input: {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
  readonly sequence: number
}): string {
  return `${input.feedId}:g${input.generation}:physical-segment-${input.sequence}`
}
