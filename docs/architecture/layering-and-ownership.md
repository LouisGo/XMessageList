# 分层与所有权

## 分层图

```text
Main / Bridge
  resolves message identity and server query contracts

MessageList Manager
  owns per-conversation session lifecycle, adapter routing, request bridge,
  `anchorMemory`, `readReceipts` workers and keepAlive retention

Renderer Data Runtime
  owns loaded segment data, merge/reset/trim policy, request dedupe

Viewport Runtime
  owns scroll container, DOM refs, measurement, visual anchors, transactions

React Adapter
  resolves session from provider, projects snapshot, registers DOM refs,
  renders slots, sends commit ack

App / Demo Host
  owns active conversation selection, manager construction, adapters and logging UI
```

对外命名以 `MessageList` 为准：公开组件是 `MessageList`，公开会话对象是
`MessageListSession`。runtime/data runtime 是内部实现。本文件继续使用
`Viewport Runtime` 描述内部所有权，因为 scroll container、visual anchor、
measurement 和 correction 都是视口运行时职责。

## Main / Bridge

Main / Bridge 负责：

- 根据 `MessageIdentityAnchor` 执行 latest / around / before / after 查询。
- 返回有序消息和边界状态。
- 表达 deleted / unavailable / permission fallback。

Main / Bridge 不负责：

- 计算 `scrollTop`。
- 推断 visual anchor。
- 决定 DOM 是否 trim。
- 读写 renderer scroll container。

## MessageList Manager

MessageList Manager 负责：

- 按 conversation id 懒创建和复用 `MessageListSession`。
- 通过 app-level adapter 路由 normal / encrypted / favorite 等业务差异。
- 接收 viewport runtime semantic need events，并调用 adapter request。
- 处理 request token、stale response、failure ack、segment publish 和 trim。
- 管理 `anchorMemory` restore/save anchor 与 `readReceipts` batching。
- 提供 `outgoing` / `incoming.append` 这类 IM 语义入口，把本人发送、他人新消息
  追加和普通 patch 区分开。
- 为 receive append 暴露 `distanceToBottom`、`pageFocused`、bottom lock 等策略
  上下文，并消费业务返回的 follow/preserve 决策。
- 按 keepAlive 策略或显式 API 销毁 session。

MessageList Manager 不负责：

- 渲染 DOM。
- 读取 row DOM 或 scrollTop。
- 在 React component unmount 时销毁会话状态。

## Renderer Data Runtime

Data runtime 负责：

- 维护当前 feed 的 loaded segment。
- 合并 before / after 分页结果。
- 对 jump / restore / follow bottom 返回 segment reset。
- 发布 immutable loaded segment：items、hasMoreBefore/After、modifier、identity remap、generation、segmentRevision。
- 基于 item 数、内存和业务策略决定 segment trim，并产出 trim 后的 next segment。

Data runtime 不负责：

- 在 DOM commit 前后修正滚动位置。
- 根据 raw scrollTop 判断分页。
- 用估算高度构造全局 offset。

## Viewport Runtime

Viewport runtime 负责：

- attach / detach scroll container。
- 对外 facade 方法命名为 `attachScrollContainer` / `detachScrollContainer`；内部 owner 仍是 viewport runtime。
- 注册 row、before trigger、after trigger、bottom marker DOM。
- 捕获 visual anchor。
- 串行执行 projection transaction：消费 data runtime 发布的 segment modifier，等待 React commit，测量 DOM，执行 scroll correction。
- commit 后同步测量并写入 anchor correction。
- 分类 scroll source，并维护 edge latch。
- 发布 viewport events、diagnostics 和 observation。

Viewport runtime 不负责：

- 调 SDK。
- 选择 feed。
- 解析业务权限。
- 渲染消息 JSX。
- 长期持有完整业务消息缓存。
- 合并、删除、去重或重排 loaded segment items。

## React Adapter

React adapter 负责：

- 根据 runtime snapshot 渲染固定 DOM skeleton。
- row wrapper 用 stable key 注册 DOM ref。
- 在 layout effect 中发送 commit ack。
- 渲染 before / after loading、error、exhausted、bottom-follow slots。
- 把 bottom-follow slot 所需的 `distanceToBottom`、`pageFocused` 等只读信号
  透传给业务渲染。

React adapter 禁止：

- 自己读写 `scrollTop`。
- 自己维护 edge paging latch。
- 根据 DOM 查询结果持久化 anchor。
- 用 React state 拆分 runtime snapshot 的 segment / edge / phase。

## App / Demo Host

Host 负责：

- 在应用层创建并持有 `MessageListManager`。
- 通过 `getConversation` / `getAdapter` 注入会话查询、请求、`anchorMemory`
  和 `readReceipts` 等业务依赖。
- 通过 manager `incoming.shouldFollowAppend` 或单次 `incoming.append({ follow })`
  决定 receive append 是否跟随；典型策略会同时参考滚动距离、页面焦点、未读
  计数和会话免打扰状态。
- 选择 active conversation，并把对应 `MessageListSession` 交给 React adapter。
- 通过 `session.commands` 发起 scroll / reload 意图。
- 通过 `session.outgoing` 接入本人 send/retry optimistic row。
- 通过 `session.incoming.append` 接入他人或服务端尾部新消息。
- 通过 `session.rows` 接入 edit、delete、reaction、streaming patch、
  identity remap、replace 和 clear 等普通 row 变更。
- demo host 只使用 public session API 作为标准接入样板；E2E-only helper 可以读取
  runtime snapshot/evidence，但只服务测试证据和 fixture reset。

Host 禁止：

- 监听 raw scroll 触发分页。
- 通过 query DOM 修正滚动位置。
- 直接操作 runtime/data runtime 作为业务接入 SOP。
- 在普通 demo 逻辑里 import E2E/internal helper 来决定分页、send/retry 或 loaded
  window 状态。
- 把 conversation 切换伪装成 runtime jump。

## 所有权判定规则

| 问题 | Owner |
| --- | --- |
| 要不要请求更多历史？ | Viewport runtime 发 semantic need，host/data 执行 |
| 请求多少条？ | Data runtime / host policy |
| before / after 返回后 items 如何合并？ | Data runtime |
| local optimistic id 如何变 server id？ | Data runtime 发布 identity-remap |
| 触边后如何保持阅读位置？ | Viewport runtime |
| scrollTop 谁能写？ | Viewport runtime |
| message DOM 谁渲染？ | React adapter / app |
| native scrollbar thumb 为何回落？ | Browser 根据真实 DOM height |
| 自定义 scrollbar thumb 怎么动？ | Overlay 镜像 native metrics |
