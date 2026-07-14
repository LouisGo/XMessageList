import type { MessageDataItem, MessageIdentityAnchor } from '../../runtime/index'
import type { MessageListPage } from '../contracts'

/** 将 host 的 deleted anchor 合同解析为 viewport 实际需要对齐的 fallback anchor。 */
export function resolveAroundPageAnchor<Row>(
  page: MessageListPage<Row>,
  items: MessageDataItem<Row>[],
  defaultAnchor: MessageIdentityAnchor | undefined,
): MessageIdentityAnchor | undefined {
  if (!page.anchorStatus || page.anchorStatus === 'normal') return defaultAnchor
  return items.find((item) =>
    item.identity?.stableId === page.anchor?.fallbackStableId
  )?.identity
}
