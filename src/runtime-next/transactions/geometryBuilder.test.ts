import { describe, expect, it } from 'vitest'
import type { MessageDataItem } from '../types'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import { buildGeometryPlan } from './geometryBuilder'
import { GeometryRelayoutBoundsError } from './geometryBuilderRelayout'

function item(messageId: string, estimatedHeight = 64): MessageDataItem<{ text: string }> {
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
    estimatedHeight,
  }
}

function committedIds(input: {
  readonly renderWindow: {
    readonly itemKeys: readonly MessageDataItem<{ text: string }>['key'][]
  }
}): string[] {
  return input.renderWindow.itemKeys.map((key) =>
    key.kind === 'committed' ? key.messageId : key.clientMessageId)
}

describe('runtime-next geometry builder', () => {
  it('keeps segmentRelayout render window inside current logical bounds', () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item(`m-${index + 1}`),
    )
    const currentSegment: PhysicalSegment = {
      segmentId: 'segment-history',
      segmentRevision: 1,
      logicalSegmentId: 'logical-history',
      logicalAnchorKey: items[3].key,
      logicalStartItemKey: items[2].key,
      logicalEndItemKey: items[4].key,
      renderWindowStartKey: items[2].key,
      renderWindowEndKey: items[4].key,
      logicalRole: 'history',
      estimatedRowsHeight: 192,
      physicalWindowHeight: 320,
      scrollHeightCap: 320,
      capMode: 'normal',
    }

    const plan = buildGeometryPlan({
      kind: 'segmentRelayout',
      data: {
        feedId: 'feed',
        generation: 1,
        revision: 2,
        items,
        hasMoreBefore: true,
        hasMoreAfter: true,
        change: {
          kind: 'patch',
          viewportModifier: 'items-change',
        },
      },
      viewportSize: {
        clientHeight: 320,
        clientWidth: 320,
      },
      currentScrollTop: 0,
      currentSegment,
    })
    const renderedIds = plan.renderWindow.itemKeys.map((key) =>
      key.kind === 'committed' ? key.messageId : key.clientMessageId,
    )

    expect(renderedIds.every((id) => ['m-3', 'm-4', 'm-5'].includes(id))).toBe(true)
    expect(plan.segment.logicalSegmentId).toBe(currentSegment.logicalSegmentId)
    expect(plan.segment.logicalStartItemKey).toEqual(currentSegment.logicalStartItemKey)
    expect(plan.segment.logicalEndItemKey).toEqual(currentSegment.logicalEndItemKey)
  })

  it('throws instead of publishing an empty relayout when logical bounds are missing', () => {
    const items = [item('new-1'), item('new-2')]
    const currentSegment: PhysicalSegment = {
      segmentId: 'segment-history',
      segmentRevision: 1,
      logicalSegmentId: 'logical-history',
      logicalAnchorKey: item('missing-anchor').key,
      logicalStartItemKey: item('missing-start').key,
      logicalEndItemKey: item('missing-end').key,
      renderWindowStartKey: item('missing-start').key,
      renderWindowEndKey: item('missing-end').key,
      logicalRole: 'history',
      estimatedRowsHeight: 192,
      physicalWindowHeight: 320,
      scrollHeightCap: 320,
      capMode: 'normal',
    }

    expect(() =>
      buildGeometryPlan({
        kind: 'segmentRelayout',
        data: {
          feedId: 'feed',
          generation: 1,
          revision: 2,
          items,
          hasMoreBefore: true,
          hasMoreAfter: true,
          change: {
            kind: 'patch',
            viewportModifier: 'items-change',
          },
        },
        viewportSize: {
          clientHeight: 320,
          clientWidth: 320,
        },
        currentScrollTop: 0,
        currentSegment,
      }),
    ).toThrow(GeometryRelayoutBoundsError)
  })

  it('builds a full adjacent segment before current logical bounds', () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item(`m-${index + 1}`, 400))
    const currentSegment: PhysicalSegment = {
      segmentId: 'segment-latest',
      segmentRevision: 1,
      logicalSegmentId: 'logical-latest',
      logicalAnchorKey: items[7].key,
      logicalStartItemKey: items[5].key,
      logicalEndItemKey: items[7].key,
      renderWindowStartKey: items[5].key,
      renderWindowEndKey: items[7].key,
      logicalRole: 'latest',
      estimatedRowsHeight: 1200,
      physicalWindowHeight: 1600,
      scrollHeightCap: 1600,
      capMode: 'normal',
    }

    const plan = buildGeometryPlan({
      kind: 'segmentShift',
      direction: 'before',
      data: {
        feedId: 'feed',
        generation: 1,
        revision: 2,
        items,
        hasMoreBefore: true,
        hasMoreAfter: false,
        change: {
          kind: 'patch',
          viewportModifier: 'items-change',
        },
      },
      viewportSize: {
        clientHeight: 320,
        clientWidth: 320,
      },
      currentScrollTop: 0,
      currentSegment,
    })

    expect(committedIds(plan)).toEqual(['m-3', 'm-4', 'm-5'])
    expect(plan.topSpacer).toBe(400)
    expect(plan.bottomSpacer).toBe(0)
  })

  it('builds a full adjacent segment after current logical bounds', () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item(`m-${index + 1}`, 400))
    const currentSegment: PhysicalSegment = {
      segmentId: 'segment-history',
      segmentRevision: 1,
      logicalSegmentId: 'logical-history',
      logicalAnchorKey: items[0].key,
      logicalStartItemKey: items[0].key,
      logicalEndItemKey: items[2].key,
      renderWindowStartKey: items[0].key,
      renderWindowEndKey: items[2].key,
      logicalRole: 'history',
      estimatedRowsHeight: 1200,
      physicalWindowHeight: 1600,
      scrollHeightCap: 1600,
      capMode: 'normal',
    }

    const plan = buildGeometryPlan({
      kind: 'segmentShift',
      direction: 'after',
      data: {
        feedId: 'feed',
        generation: 1,
        revision: 2,
        items,
        hasMoreBefore: false,
        hasMoreAfter: true,
        change: {
          kind: 'patch',
          viewportModifier: 'items-change',
        },
      },
      viewportSize: {
        clientHeight: 320,
        clientWidth: 320,
      },
      currentScrollTop: 0,
      currentSegment,
    })

    expect(committedIds(plan)).toEqual(['m-4', 'm-5', 'm-6'])
    expect(plan.topSpacer).toBe(0)
    expect(plan.bottomSpacer).toBe(400)
  })
})
