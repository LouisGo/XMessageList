# Message Runtime 文档索引

本目录沉淀 TypeX PC 新消息锚点模型与消息运行时设计。这里的文档面向新架构：以消息身份锚点为跨层坐标，以视图无关数据运行时承接 main / renderer 数据管理，以 renderer 视口运行时承接滚动、测量和锚点稳定。

当前 `packages/typex-pc-render/src/@messageList` 只代表迁移期集成边界，不作为新架构设计范式。

## 阅读入口

| 文档 | 状态 | 何时阅读 | 描述词 |
| --- | --- | --- | --- |
| [message-anchor-mental-model.md](./message-anchor-mental-model.md) | 已有 | 需要统一“消息锚点”术语、坐标系、跨层语义时 | identity anchor, viewport anchor, bottom anchor |
| [message-data-runtime-architecture.md](./message-data-runtime-architecture.md) | 已有 | 需要理解 main 进程与 renderer 数据层如何视图无关地管理消息窗口、around/latest 数据和缓存时 | view-agnostic data runtime, Bridge contract, DataWindow |
| [message-viewport-runtime-architecture.md](./message-viewport-runtime-architecture.md) | 已有 | 需要理解消息滚动容器的新内核原则时 | deterministic viewport runtime, flow-first layout, anchor-first scroll |
| [message-viewport-runtime-supplemental-spec.md](./message-viewport-runtime-supplemental-spec.md) | 已有 | 需要补齐 bootstrap、bottom lock、React 边界等运行时状态机细节时 | bootstrap, bottom lock, React projection boundary |
| [message-runtime-layering-and-ownership.md](./message-runtime-layering-and-ownership.md) | 已有 | 需要判断逻辑应该归属 main、renderer 数据运行时、viewport runtime、React 投影层还是 actions 时 | ownership boundary, process split, semantic command |
| [message-runtime-implementation-contract.md](./message-runtime-implementation-contract.md) | 已有 | 需要从零实现 runtime、定义 API、command、transaction、React commit 回执和测试合同前 | public API, transaction, command queue |
| [message-list-transition-boundary.md](./message-list-transition-boundary.md) | 已有 | 需要处理迁移期 `@messageList` 与新架构共存、替换和隔离策略时 | migration boundary, legacy adapter, compatibility surface |
| [runtime/README.md](./runtime/README.md) | 新增 | 需要具体实现 IM 滚动视图容器 runtime、React adapter、RenderWindow、spacer、transaction、teardown 和测试时 | viewport runtime implementation, React external store, DOM registry |

## 建议阅读路径

1. 建立术语：先读 `message-anchor-mental-model.md`。
2. 判断数据归属：读 `message-data-runtime-architecture.md`。
3. 判断滚动与视口归属：读 `message-viewport-runtime-architecture.md`。
4. 处理状态机细节：读 `message-viewport-runtime-supplemental-spec.md`。
5. 做实现落点或评审：读 `message-runtime-layering-and-ownership.md`。
6. 从零实现 runtime：读 `message-runtime-implementation-contract.md`。
7. 具体实现滚动视图容器：读 `runtime/README.md` 及其子文档。
8. 涉及现有 `@messageList`：最后读 `message-list-transition-boundary.md`。

## 分层心智模型

```text
Message Identity Anchor
  -> View-agnostic Message Data Runtime
     -> main process SDK / Bridge contracts
     -> renderer data cache / subscriptions
  -> Renderer Viewport Runtime
     -> DOM window / spacer / measurement
     -> scroll intent / bottom lock / anchor stabilization
  -> React Projection
     -> message row rendering
     -> local interaction UI
```

## 命名约定

- `message-anchor-*`：锚点术语、坐标与跨层语义。
- `message-data-runtime-*`：视图无关的数据读取、缓存、订阅、Bridge 合同。
- `message-viewport-runtime-*`：renderer 内部视口、滚动、测量、稳定化。
- `message-runtime-layering-*`：跨进程、跨层职责归属。
- `message-runtime-implementation-*`：runtime 外部 API、transaction、command、React commit 回执。
- `runtime/*`：专注 renderer 内部滚动视图容器 runtime 的实现施工图。
- `message-list-*`：仅用于迁移期边界说明，不代表新架构核心命名。
