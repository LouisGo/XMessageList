# Message Viewport Runtime 架构入口

本文件不再承载主规范。

新的 viewport runtime 架构已经切换为 **Physical Segment Windowing**：

- `scrollHeight` 不再代表已加载数据总高度。
- `topSpacer / bottomSpacer` 只代表当前 physical segment 内的 overscan。
- `SegmentShift` 是几何事务，不是 prepend / append 的副作用。
- custom scrollbar 是几何层，不是只隐藏 native scrollbar 的皮肤。
- diagnostics 必须检测 scrollHeight cap、spacer-only viewport、shift loop、thumb 数据耦合等架构违约。

请从这里继续：

- [../viewport-runtime/physical-segment-architecture.md](../viewport-runtime/physical-segment-architecture.md)
- [../viewport-runtime/README.md](../viewport-runtime/README.md)

保留本文件只是为了避免旧链接失效。后续不要在这里补充新设计。
