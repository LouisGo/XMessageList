# Flutter Message Runtime Architecture

本目录定义 Flutter 移动端需要共同遵守的消息运行时架构。

这些文档是跨端共识，不是某个 UI 框架的实现说明。Flutter 端可以自行选择组件、
状态管理和渲染方式，但不能改变锚点、数据、视口和投影层的 ownership。

## 文档

| 文档 | 何时阅读 | 核心问题 |
| --- | --- | --- |
| [message-anchor-mental-model.md](./message-anchor-mental-model.md) | 先读 | 什么才是可跨层传递的消息坐标 |
| [message-data-runtime-and-sdk-contract.md](./message-data-runtime-and-sdk-contract.md) | 对接 SDK 前 | `getLatestMessages` 与 `getMessagesAround` 如何进入数据层 |
| [message-runtime-layering-and-ownership.md](./message-runtime-layering-and-ownership.md) | 划分模块前 | 哪些逻辑属于 SDK、data runtime、viewport runtime、projection shell |
| [message-viewport-runtime-architecture.md](./message-viewport-runtime-architecture.md) | 设计滚动容器前 | 为什么必须用锚点优先、运行时拥有滚动语义的模型 |

## 架构模型

```text
App Session Host
  -> SDK Adapter
  -> Message Data Runtime
  -> Message Viewport Runtime
  -> Flutter Projection Shell
```

其中：

- App Session Host 决定当前 feed、runtime cache、会话切换和销毁策略。
- SDK Adapter 屏蔽 native SDK 形状，输出稳定数据合同。
- Message Data Runtime 维护 DataWindow、增量合并和数据可用性。
- Message Viewport Runtime 维护用户正在观察的视口。
- Flutter Projection Shell 只负责视觉投影和局部交互。

## 必须统一的设计决策

- `MessageIdentityAnchor` 是跨 SDK / data / viewport 层的消息身份坐标。
- `AnchorState` 是 viewport runtime 本地坐标，不跨进程、不作为 SDK 入参。
- `BottomAnchor` 只在 `hasMoreAfter == false` 且 bottom lock 成立时有效。
- DataWindow 不能直接推导滚动几何。
- MaterializedWindow 不能作为数据完整性边界。
- Projection shell 不能自己做分页判断、滚动恢复或持久化 anchor 捕获。

