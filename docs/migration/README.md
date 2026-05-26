# 迁移边界

本文件定义从旧 spacer 基座迁到 next loaded segment 基座时的取舍。它不是兼容承诺；next 分支允许破坏旧内部实现。

## 必须删除的旧概念

- top spacer / bottom spacer 作为 DOM 高度。
- RenderWindow 在 DataWindow 内滑动并用 spacer 补远端高度。
- spacer compaction。
- custom scrollbar virtual travel。
- 用 estimated total height 解释 thumb 位置。
- 用 raw scrollTop 持久化 feed restore。

这些词可以出现在迁移说明或禁止事项中，但不能作为新设计的正向机制。

## 可保留的旧能力

- Runtime owns scroll / measurement / transaction。
- React adapter uses external store and commit ack。
- Visual anchor correction。
- `viewportAnchorChanged` persistence hook。
- Bottom lock hysteresis。
- Generation guard。
- Diagnostics ring buffer。
- E2E evidence collector 思路。

## API 迁移方向

旧 public surface：

```ts
MessageViewport
MessageViewportRuntime
MessageViewportSnapshot
useMessageViewportSnapshot
useMessageViewportSelector
runtime.setDataSnapshot(...)
runtime.dispatch({ type: 'followBottom' | 'jump' | 'restore' })
```

新 public surface：

```ts
MessageList
createMessageListRuntime
MessageListRuntime
MessageListSnapshot
useMessageListSnapshot
useMessageListSelector
runtime.applyLoadedSegment(...)
runtime.scrollToLatest()
runtime.scrollToMessage(target)
runtime.restoreToMessage(target)
```

完整命名对照以 [architecture/naming-and-api.md](../architecture/naming-and-api.md) 为准。

旧 snapshot：

```ts
items + renderWindow + topSpacer + bottomSpacer
```

新 snapshot：

```ts
items + segmentMeta(hasMoreBefore/After, modifier, anchor, shortSegmentAlignment)
  + edgeState + bottomLockState + pendingIntent + viewportPhase
  + generation/segmentRevision/projectionRevision/commitToken
```

旧 data modifier：

```ts
prepend / append / reset / viewport-compaction
```

新 data modifier：

```ts
extend-before / extend-after / reset-around / reset-latest / trim-before / trim-after / patch / identity-remap
```

## 实施边界

迁移应先文档后代码：

1. 删除旧 docs 口径。
2. 建立新 interaction specs。
3. 改 runtime public contracts。
4. 改 React projection DOM。
5. 改 transaction。
6. 改 E2E harness evidence。
7. 最后处理 demo/app 接入。

每一步都要保证旧 spacer 机制没有被“临时兼容”重新引入核心路径。

## 风险清单

| 风险 | 防线 |
| --- | --- |
| segment 太大导致 DOM 压力 | segment budget + trim transaction |
| trim 后阅读位置跳动 | trim 必须 anchor correction |
| after edge 与 follow bottom 混淆 | pending follow bottom 抑制 after edge |
| 短 segment 同时触发 before/after | underflow-fill 仲裁，一轮只允许一个 edge |
| optimistic id 变 server id 导致 anchor 丢失 | identity-remap modifier + stable runtime key |
| overlay thumb 与 native 不一致 | overlay 只读 native metrics |
| React ref 晚于 commit ack | correction 可等一帧再 fallback |
| dynamic height 抖动 | ResizeObserver dirty batching |
