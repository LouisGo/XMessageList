# 外部技术调研记录

本文记录外部实现如何转译到当前 physical segment 架构。合同以前面几份 runtime 文档为准。

## 1. React Virtuoso

参考：

- Message List scroll modifier：https://virtuoso.dev/virtuoso-message-list/scroll-modifier/
- Message List DataMethods：https://virtuoso.dev/virtuoso-message-list-api/interfaces/DataMethods/
- Follow output：https://virtuoso.dev/virtuoso-api/interfaces/VirtuosoProps/#followoutput
- At bottom threshold：https://virtuoso.dev/virtuoso-api/interfaces/VirtuosoProps/#atbottomthreshold

可吸收：

- 数据变化需要显式语义 modifier。
- follow bottom 不是每次 append 都滚到底。
- prepend / append 不能让组件 effect 猜测滚动意图。

转译到本 runtime：

- `viewportModifier` 是数据变化语义，不是 physical transaction kind。
- `prepend` / `append` 只更新 DataWindow。
- active geometry 由 `SegmentShift`、`SegmentRelayout`、`projectionRefresh` 或 `followBottom` 消费数据结果。

不采用：

- 通用 virtual list 的全局 index 坐标。
- 让 React prop 拥有滚动策略。
- 让累计数据高度决定 scrollbar thumb。

## 2. Telegram Web A

参考：

- `MessageList.tsx`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/MessageList.tsx
- `MessageListHistoryHandler.tsx`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/MessageListHistoryHandler.tsx
- `useMessageObservers.ts`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/hooks/useMessageObservers.ts
- `useScrollHooks.ts`：https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/hooks/useScrollHooks.ts

可吸收：

- 成熟 IM 容器会直接管理 DOM refs、observer、scroll hooks。
- 历史加载和 viewport 修正必须分阶段。
- 用户滚动和程序滚动必须区分。
- custom scrollbar 可以脱离 native scrollbar thumb 几何。

转译到本 runtime：

- runtime 是 imperative engine，不是 hook 链。
- native scrollbar 仅作为隐藏的 DOM scroll surface。
- visible thumb 几何来自 physical segment metrics。
- segment shift 是 runtime transaction。

## 3. Telegram Web K

参考：

- `bubbles.ts`：https://github.com/morethanwords/tweb/blob/master/src/components/chat/bubbles.ts

可吸收：

- DOM 生命周期、cleanup、异步回调污染是 IM 容器核心问题。
- 删除、折叠、动态高度变化时需要 anchor preservation。
- 远距离定位不应依赖浏览器 smooth scroll。

转译到本 runtime：

- jump / restore 先构造 target physical segment。
- 内容高度变化先 local correction，必要时 segment relayout。
- feed teardown 必须取消 motion、drag lock、pending commit、observer。

## 4. Browser APIs

ResizeObserver：

- 只作为 dirty height signal。
- callback 内不写 scrollTop。
- 由 rAF / transaction 合并成 local correction 或 segment relayout。

IntersectionObserver：

- 只作为 edge pre-signal。
- 不能直接修改 window。
- edge latch 必须包含 physical segment revision。

`scrollHeight`：

- 仍是 DOM scroll container 的物理结果。
- 但它只允许表达 active physical segment 的局部高度。
- 不允许表达已加载 DataWindow 总高度。

## 5. React External Store

Projection snapshot 是 React external store。

Physical scroll metrics 是另一条更高频的 runtime store。

```text
Message rows subscribe projection snapshot.
Custom scrollbar subscribes physical metrics.
```

这样普通 scroll frame 不会 rerender row tree。

## 6. 取舍总结

| Topic | Decision |
| --- | --- |
| Core abstraction | Physical Segment Viewport Runtime |
| Data | DataWindow availability, not geometry |
| Geometry | active PhysicalSegment |
| Scrollbar | custom visible thumb, native hidden |
| Spacer | local segment overscan only |
| Shift | transaction, not scroll handler side effect |
| Motion | inside stable segment only |
| React | projection and pointer forwarding |
| Diagnostics | invariant enforcement surface |
