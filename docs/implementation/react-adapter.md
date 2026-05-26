# React Adapter 合同

## Adapter 职责

React adapter 是 projection 层：

- 使用 `useMessageListSnapshot` / `useMessageListSelector` 读取 runtime snapshot。
- 渲染固定 DOM skeleton。
- 给每个 row 注册 DOM ref。
- 在 layout effect 中发送 commit ack。
- 渲染 slots：before edge、after edge、scroll-to-latest、overlay。

## External Store

要求：

- `getSnapshot()` 返回稳定对象。
- snapshot revision 只在 React 需要重新 commit 时递增。
- 相同 `items + segmentMeta + edgeState + bottomLockState + pendingIntent + phase` 不创建新 snapshot。
- React 不拆分 snapshot 后自行组合。
- `hasMoreBefore/After`、modifier、generation、segmentRevision 和 commitToken 必须随 snapshot 一起发布；adapter 不从外部 props 补这些字段。

## Commit Ack

每次 `projectionRevision` 改变：

```text
render
-> row refs registered
-> layout effect
-> runtime.ackProjectionCommit(commitToken)
```

StrictMode 下可能出现 attach/detach/attach，ack 必须带 feedId/generation/segmentRevision/projectionRevision，runtime 只接受当前 token。

## Row Wrapper

Row wrapper 必须：

- 使用 runtime item key 作为 React key。
- ref callback 调用 `registerRowElement(key, element)` register/unregister DOM。
- 保留 `data-runtime-key`、`data-row-kind` 和可选的 `data-message-stable-id` / `data-message-server-id` testing attribute。
- 不读写 scrollTop。

Row wrapper 可以：

- 渲染业务消息内容。
- 暴露 measured-friendly DOM boundary。
- 支持 memoization 和 explicit render version。

## Slots

Slots 接收 runtime semantic state，不接收 raw DOM metrics：

- `renderBeforeEdge(input)`
- `renderAfterEdge(input)`
- `renderScrollToLatest(input)`
- `renderOverlay(input)`

`renderBeforeEdge` / `renderAfterEdge` 的 `retry()` 只能回调 adapter-private `retryEdgeRequest(edge)`；slot 不持有 request token，不直接请求 SDK。

Slots 禁止：

- query row DOM。
- 监听 raw scroll。
- 直接触发 SDK 请求。
- 直接写 `scrollTop`。

## Custom Scrollbar Overlay

如果 adapter 提供 overlay：

- overlay controller 只读 native metrics。
- drag / track click 调 runtime adapter-private direct scroll API：`beginDirectScroll` / `writeDirectScrollTop` / `endDirectScroll`。
- overlay metric 与 runtime evidence 的 `clientHeight` / `scrollHeight` 不一致时，必须上报 `overlay.metricMismatch` warning diagnostic。
- overlay 不进入 core snapshot。
- overlay 不改变 DOM skeleton。

## App Integration

App 只通过 runtime events 接入：

- `needMoreBefore`
- `needMoreAfter`
- `needLatestMessages`
- `needMessagesAround`
- `viewportAnchorChanged`
- `viewportObservationChanged`
- diagnostics

App 对 `needMoreBefore` / `needMoreAfter` 必须把 runtime event 的 `requestToken` 交给 data runtime 采用；请求失败时用 `reportEdgeRequestFailure(edge, requestToken)` ack。App 不通过 ref 拿 scroll container 来补逻辑。
