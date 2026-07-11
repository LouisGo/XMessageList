import type {
  MessageListReloadCurrentResult,
  MessageListReloadLatestResult,
} from '../contracts'

/** 把共享 reload transaction 的内部终态收窄为 latest 公共终态。 */
export function toReloadLatestResult<Row>(
  result: MessageListReloadCurrentResult<Row>,
): MessageListReloadLatestResult<Row> {
  if (result.status === 'applied') {
    return { status: 'applied', page: result.page }
  }
  if (result.status === 'stale') {
    return { status: 'stale', staleReason: result.staleReason }
  }
  return {
    status: 'failed',
    failureReason: result.failureReason,
    error: result.error,
  }
}
