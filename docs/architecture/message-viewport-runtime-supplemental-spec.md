# Message Viewport Runtime 补充规范入口

本文件不再承载主规范。

Bootstrap、bottom lock、React projection、scroll motion、diagnostics 等细节已经并入新的 runtime-next / physical segment 文档体系：

- [../viewport-runtime/runtime-next-architecture.md](../viewport-runtime/runtime-next-architecture.md)
- [../viewport-runtime/physical-segment-architecture.md](../viewport-runtime/physical-segment-architecture.md)
- [../viewport-runtime/runtime-container-architecture.md](../viewport-runtime/runtime-container-architecture.md)
- [../viewport-runtime/transaction-and-scroll-timing.md](../viewport-runtime/transaction-and-scroll-timing.md)
- [../viewport-runtime/react-projection-adapter-contract.md](../viewport-runtime/react-projection-adapter-contract.md)

后续重构不得回到连续 DataWindow scrollHeight 模型，也不得继续在旧 `src/runtime.deprecated` 上 graft。新实现进入 `src/runtime-next`。保留本文件只是为了避免旧链接失效。
