export type DemoFeedDefinition = {
  id: string
  title: string
  subtitle: string
  seedCount: number
  unread: number
}

export const DEMO_FEEDS: DemoFeedDefinition[] = [
  {
    id: 'feed-runtime',
    title: 'Runtime Lab',
    subtitle: 'Loaded segment debugging',
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
  return DEMO_FEEDS.find((feed) => feed.id === feedId) ?? DEMO_FEEDS[0]
}
