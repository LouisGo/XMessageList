# Flutter Viewport Runtime Docs

本目录定义 Flutter 消息滚动视图容器的运行时合同。

它不重复解释：

- `MessageIdentityAnchor` 的跨层语义。
- `getLatestMessages` / `getMessagesAround` 的 SDK 合同。
- App session host 的 cache policy。
- 业务消息 cell 的具体视觉实现。

## Runtime 目标

Viewport runtime 是一个 platform-local imperative engine。它拥有：

- attach / detach projection host。
- materialized row registry。
- MaterializedWindow 计算。
- before / after extent 估算。
- row measurement 与 height cache。
- scroll intent classification。
- bottom lock。
- viewport transaction。
- projection snapshot publish。
- viewport-level events。

Projection shell 只拥有：

- message row rendering。
- unread marker、edge loading、bottom follow affordance。
- layout committed ack。
- materialized row handle registration。
- local interaction UI。
- semantic command dispatch。

## 阅读顺序

| 文档 | 核心问题 |
| --- | --- |
| [runtime-container-contract.md](./runtime-container-contract.md) | runtime 公开 surface、事件和状态机 |
| [projection-adapter-contract.md](./projection-adapter-contract.md) | Flutter projection shell 如何连接 runtime 而不拥有滚动逻辑 |
| [window-and-extent-algorithms.md](./window-and-extent-algorithms.md) | window 怎么滑动，extent 怎么估算和修正 |
| [transaction-and-scroll-timing.md](./transaction-and-scroll-timing.md) | projection 提交后何时测量、何时修正滚动位置 |
| [scroll-motion-and-animation.md](./scroll-motion-and-animation.md) | follow bottom / jump 动画如何不破坏确定性 |
| [lifecycle-and-testing.md](./lifecycle-and-testing.md) | feed 切换、generation safety、测试矩阵 |

## 实现边界

Runtime 可以读取平台滚动度量、row size 和 viewport size，但不渲染具体消息内容。

Runtime 可以持有 item key、height cache、window index 和 extent estimate，但不长期持有
完整业务消息缓存。

Runtime 可以发出需要更多数据的语义事件，但不直接调用 SDK，不决定 SDK 参数，不解释
业务权限。

Data runtime 负责把 `MessageIdentityAnchor` 解析成当前 `MessageDataSnapshot` 内
可定位的数据窗口，包括 deleted anchor 的 nearest-neighbor fallback。

Viewport runtime 只处理投影内的本地 fallback：目标 item 已在 snapshot 中但 layout 后
不可测量时，可以 retry 或选择当前 projection 内 nearest measurable row。

