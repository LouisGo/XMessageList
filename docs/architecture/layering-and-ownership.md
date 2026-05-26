# 分层与所有权

## 分层图

```text
Main / Bridge
  resolves message identity and server query contracts

Renderer Data Runtime
  owns loaded segment data, merge/reset/trim policy, request dedupe

Viewport Runtime
  owns scroll container, DOM refs, measurement, visual anchors, transactions

React Adapter
  projects snapshot, registers DOM refs, renders slots, sends commit ack

App / Demo Host
  owns feed activation, runtime cache, fake/real data source, logging UI
```

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

React adapter 禁止：

- 自己读写 `scrollTop`。
- 自己维护 edge paging latch。
- 根据 DOM 查询结果持久化 anchor。
- 用 React state 拆分 runtime snapshot 的 segment / edge / phase。

## App / Demo Host

Host 负责：

- 创建并缓存 per-feed runtime。
- 订阅 `viewportAnchorChanged` 并持久化 identity anchor。
- 响应 `needMoreBefore` / `needMoreAfter` / `needLatestMessages` / `needMessagesAround`。
- 把请求结果转成 data snapshot。
- 记录 diagnostics 和 E2E evidence。

Host 禁止：

- 监听 raw scroll 触发分页。
- 通过 query DOM 修正滚动位置。
- 把 feed 切换伪装成 runtime jump。

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
