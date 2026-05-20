import { describe, expect, it } from 'vitest'
import { createInitialPhysicalScrollMetrics } from '../geometry/metrics/initialMetrics'
import type { PendingGeometryProjection } from '../geometry/publication/publication.types'
import type { MessageDataItem } from '../types'
import { decidePromotionCorrection } from './transactionPromoter'

function item(messageId: string): MessageDataItem<{ text: string }> {
  return {
    kind: 'committed',
    key: {
      kind: 'committed',
      messageId,
    },
    message: {
      text: messageId,
    },
    version: 1,
    estimatedHeight: 500,
  }
}

function publication(): PendingGeometryProjection<{ text: string }> {
  const message = item('m-1')

  return {
    commitToken: {
      feedId: 'feed',
      generation: 1,
      projectionRevision: 1,
      segmentId: 'segment-1',
      segmentRevision: 1,
      transactionId: 'tx-1',
    },
    segment: {
      segmentId: 'segment-1',
      segmentRevision: 1,
      logicalSegmentId: 'logical-1',
      logicalAnchorKey: message.key,
      logicalStartItemKey: message.key,
      logicalEndItemKey: message.key,
      renderWindowStartKey: message.key,
      renderWindowEndKey: message.key,
      logicalRole: 'history',
      estimatedRowsHeight: 500,
      physicalWindowHeight: 1000,
      scrollHeightCap: 1000,
      capMode: 'normal',
    },
    items: [message],
    renderWindow: {
      startIndex: 0,
      endIndex: 0,
      itemKeys: [message.key],
    },
    topSpacer: 100,
    bottomSpacer: 400,
    naturalBlankHeight: 0,
    physicalWindowHeight: 1000,
    mountedRowsHeightEstimate: 500,
  }
}

describe('runtime-next transaction promotion measurement correction', () => {
  it('uses estimated mounted rows as baseline and passes measured delta as fact', () => {
    const decision = decidePromotionCorrection({
      publication: publication(),
      dataRevision: 1,
      scrollTop: 100,
      clientHeight: 200,
      measuredRowsHeight: 550,
      previousMetrics: createInitialPhysicalScrollMetrics({
        feedId: 'feed',
        generation: 1,
      }),
      previousCorrections: [],
    })

    expect(decision).toEqual({
      mountedRowsHeight: 550,
      correction: {
        kind: 'local-spacer-correction',
        topDelta: 0,
        bottomDelta: -50,
      },
    })
  })
})
