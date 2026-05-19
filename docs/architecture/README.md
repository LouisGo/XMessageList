# Message Runtime 文档索引

本目录沉淀消息运行时的跨层架构。Viewport runtime 的当前主规范已经迁移到 `docs/viewport-runtime`，并以 physical segment 为唯一新设计基线。

## 阅读入口

| 文档 | 何时阅读 | 核心问题 |
| --- | --- | --- |
| [message-anchor-mental-model.md](./message-anchor-mental-model.md) | 需要统一消息身份锚点、viewport anchor、bottom anchor 时 | anchor coordinate |
| [message-data-runtime-architecture.md](./message-data-runtime-architecture.md) | 需要理解 main / renderer 数据层如何管理 DataWindow、around/latest 和缓存时 | view-agnostic data runtime |
| [message-runtime-layering-and-ownership.md](./message-runtime-layering-and-ownership.md) | 需要判断逻辑归属 main、renderer data runtime、viewport runtime、React projection 还是 actions 时 | ownership boundary |
| [../viewport-runtime/physical-segment-architecture.md](../viewport-runtime/physical-segment-architecture.md) | 需要理解新的消息滚动容器内核时 | physical segment, capped scrollHeight, segment shift |
| [../viewport-runtime/README.md](../viewport-runtime/README.md) | 需要进入具体 runtime 施工文档时 | implementation docs index |
| [../typex-transition/message-list-transition-boundary.md](../typex-transition/message-list-transition-boundary.md) | 需要处理迁移期旧 message list 边界时 | transition boundary |

## 分层心智模型

```text
Message Identity Anchor
  -> View-agnostic Message Data Runtime
     -> SDK / Bridge / renderer data cache
  -> Renderer Viewport Runtime
     -> PhysicalSegment / CustomScrollbar / SegmentShift
     -> DOM rows / local spacers / measurement / diagnostics
  -> React Projection
     -> row rendering / slots / pointer event forwarding
```

## 旧文档状态

`message-viewport-runtime-architecture.md` 和 `message-viewport-runtime-supplemental-spec.md` 已不再作为主规范。它们保留为历史入口，并指向新的 physical segment 文档。
