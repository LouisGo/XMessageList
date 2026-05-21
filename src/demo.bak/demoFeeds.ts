export type DemoFeedDefinition = {
  id: string
  title: string
  subtitle: string
  seedCount: number
  unread: number
}

/**
 * Demo 固定维护 5 个会话入口，用来模拟真实 IM 中切 feed 后恢复本地数据窗口。
 * 初始消息是 mock 生成的，但一旦写入本地 store，后续切换都会读取持久化快照。
 */
export const DEMO_FEEDS: DemoFeedDefinition[] = [
  {
    id: 'feed-runtime',
    title: 'Runtime Lab',
    subtitle: 'Anchor / spacer debugging',
    seedCount: 80,
    unread: 3,
  },
  {
    id: 'feed-design',
    title: 'Design Review',
    subtitle: 'Long text and media bursts',
    seedCount: 72,
    unread: 0,
  },
  {
    id: 'feed-release',
    title: 'Release Room',
    subtitle: 'Fast appends near bottom',
    seedCount: 96,
    unread: 12,
  },
  {
    id: 'feed-support',
    title: 'Support Escalation',
    subtitle: 'History paging pressure',
    seedCount: 64,
    unread: 1,
  },
  {
    id: 'feed-random',
    title: 'Random Chat',
    subtitle: 'Mixed daily traffic',
    seedCount: 88,
    unread: 6,
  },
]

export function getDemoFeedDefinition(feedId: string): DemoFeedDefinition {
  return (
    DEMO_FEEDS.find((feed) => feed.id === feedId) ??
    DEMO_FEEDS[0] ??
    {
      id: 'feed-runtime',
      title: 'Runtime Lab',
      subtitle: 'Anchor / spacer debugging',
      seedCount: 80,
      unread: 0,
    }
  )
}
