export type DemoFeedDefinition = {
  id: string
  title: string
  subtitle: string
  seedCount: number
}

export const DEMO_FEEDS: DemoFeedDefinition[] = [
  {
    id: 'feed-runtime',
    title: 'Runtime Rewrite',
    subtitle: 'Phase-gated next branch',
    seedCount: 32,
  },
  {
    id: 'feed-design',
    title: 'Design Review',
    subtitle: 'Loaded segment contracts',
    seedCount: 24,
  },
]

export function getDemoFeedDefinition(feedId: string): DemoFeedDefinition {
  return DEMO_FEEDS.find((feed) => feed.id === feedId) ?? DEMO_FEEDS[0]
}
