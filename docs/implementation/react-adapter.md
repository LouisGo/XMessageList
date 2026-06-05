# React Adapter 合同

## Adapter 职责

React adapter 是 projection 层：

- 默认通过 `MessageListSessionRegistryProvider` / `useMessageListSession(sessionId)`
  获取应用级
  `MessageListSession`。
- 通过 package-internal session internals 读取 runtime snapshot。
- 渲染固定 DOM skeleton。
- 给每个 row 注册 DOM ref。
- 在 layout effect 中发送 commit ack。
- 渲染 slots：before status、after status、top placeholder、overlay status、empty、scroll-to-latest。

React adapter 不发起业务请求，不合并请求结果，不保存 anchor，也不实现已读回执。上述职责属于 session registry/session adapter。

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

StrictMode 下可能出现 attach/detach/attach，ack 必须带 sessionId/generation/segmentRevision/projectionRevision，runtime 只接受当前 token。

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

- `renderBeforeStatus(input)`
- `renderAfterStatus(input)`
- `renderTopPlaceholder()`
- `renderOverlayStatus(input)`
- `renderEmpty(input)`
- `renderScrollToLatest(input)`

`renderTopPlaceholder()` 只在 `snapshot.segmentMeta.hasMoreBefore=false` 时
渲染，表示当前 segment 已经抵达真实历史开头；它不是当前已加载窗口顶部的常驻
装饰。

`renderOverlayStatus(input)` 接收 `status` / `retry` / `error`，来源是
session view state。overlay slot 不订阅 viewport observation，避免滚动过程被
额外 React state 打断。

`renderBeforeStatus` / `renderAfterStatus` 的 `retry()` 只能回调 adapter-private `retryEdgeRequest(edge)`；slot 不持有 request token，不直接请求 SDK。

Slots 禁止：

- query row DOM。
- 监听 raw scroll。
- 直接触发 SDK 请求。
- 直接写 `scrollTop`。

## Custom Scrollbar Overlay

如果 adapter 提供 overlay：

- overlay 只读 native metrics。
- drag / track click 调 runtime adapter-private direct scroll API：`beginDirectScroll` / `writeDirectScrollTop` / `endDirectScroll`。
- overlay metric 与 runtime evidence 的 `clientHeight` / `scrollHeight` 不一致时，必须上报 `overlay.metricMismatch` warning diagnostic。
- overlay 不进入 core snapshot。
- overlay 不改变 DOM skeleton。

## App Integration

App 默认通过 session registry adapter 接入：

- `adapter.row`：业务 row key、anchor、version、kind。
- `adapter.request`：`loadLatest` / `loadBefore` / `loadAfter` / `loadAround`。
- `adapter.anchorMemory`：可选的 `{ anchor, offsetWithinMessage }` load/save。
- `adapter.readReceipts`：可选的批量已读回执。

Session registry 将 runtime semantic need events 接到 adapter request，负责 request token、stale response、failure ack、segment publish 和 trim。App 不通过 ref 拿 scroll container 来补逻辑。
