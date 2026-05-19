# Lifecycle 与验证合同

本文定义 physical segment runtime 的生命周期、安全清理和未来验证矩阵。这里不要求当前阶段编写测试，但实现重构必须能被这些不变量验证。

## 1. Generation Contract

每个 runtime 实例都带：

```ts
type RuntimeGeneration = {
  feedId: string;
  generation: number;
};
```

所有异步回调执行前检查 generation：

- commit ack
- requestAnimationFrame
- setTimeout
- ResizeObserver
- IntersectionObserver
- physical metrics subscriber
- data response
- event callback

```ts
if (!lifecycleGuard.isCurrent(feedId, generation)) return;
```

## 2. Attach / Detach / Destroy

`attach(container)`：

- 保存 scroll container。
- 恢复 retained physical scroll position，但标记为 programmatic write。
- 注册 scroll listener、ResizeObserver、IntersectionObserver。
- 初始化 physical metrics。
- 如已有 pending bootstrap / pending segment shift，恢复事务驱动。

`detach()`：

- capture viewport anchor，并发出 `viewportAnchorChanged(reason: 'detach')`。
- 保存 active segment、segmentRevision、scrollTop 和 projection snapshot。
- 取消 active motion、pending commit、rAF、drag lock。
- disconnect observers。
- 清 DOM refs。
- 保留可复用 height cache 和数据层状态。

`destroy()`：

- 调用 detach。
- 清 command queue、height cache、listeners、diagnostics buffer。
- 标记 `DESTROYED`。
- 拒绝后续 command / snapshot / direct scroll。

`detach` 用于 React projection 临时卸载。`destroy` 用于 runtime 彻底废弃。

## 3. Feed Runtime Cache

生产 IM 页面应由 conversation/session host 按 feed 持有 runtime cache。

规则：

- feed 切走时 detach，不 destroy。
- feed 切回且 runtime cache 命中时，不重新 bootstrap 同一 runtime。
- LRU 淘汰、会话关闭或页面销毁时 destroy。
- React StrictMode 的模拟 cleanup 不能误销毁仍会复用的 runtime。
- detach anchor event 必须带 feedId + generation，host 不能用当前 active feed 代替。

## 4. Cleanup Order

推荐顺序：

```text
mark generation inactive
-> stop accepting direct scroll and commands
-> cancel active motion
-> clear drag lock
-> cancel pending commit timeout
-> cancel rAF
-> disconnect observers
-> remove DOM listeners
-> clear DOM refs
-> retain stable segment/projection state if detach
```

先 mark inactive，防止清理过程中旧回调继续修改物理几何。

## 5. Recovery Policy

| Violation | Production recovery | Dev/test behavior |
| --- | --- | --- |
| `physical.scrollHeightExceededCap` | segment relayout or exceptional cap | assert if repeated |
| `physical.spacerOnlyViewport` | immediate anchor-based relayout | hard fail acceptable |
| `physical.segmentShiftLoop` | suppress next shift and rebase safe zone | hard fail after threshold |
| `physical.spacerOscillationSameRevision` | freeze local correction, one relayout | assert diagnostic |
| stale shift target data | remain pending and emit need event | assert no blank segment |
| drag lock stolen | cancel conflicting writer | hard fail acceptable |

Runtime 不应该静默吞掉 architecture violation。必须输出 diagnostics，且 recovery 路径不能重新扩大 DataWindow scrollHeight。

## 6. Validation Matrix

这些是后续实现的验收场景，不是当前阶段必须补测试。

### 0. Geometry Decoupling Guardrails

后续实现必须先验证这些硬边界：

- `projectionRefresh` 不改变 segment id/revision、logical bounds、render window、spacer、`physicalWindowHeight` 或 `scrollTop`。
- prefetch band 只改变 data readiness / adjacent prefetch diagnostics，不改变 committed physical metrics。
- `prepend` / `append` 只作为 DataWindow modifier 存在，不能作为 viewport transaction kind。
- safe scroll range coverage 用 `realRowCoveragePx >= minRealRowCoveragePx` 验证；short-feed 是显式特例，不是 normal segment 的 spacer 暴露。

### A. Bootstrap

目标：

- latest bootstrap 构造 latest segment。
- restored bootstrap 构造 target segment。
- bootstrap 期间不触发 edge need、segment shift、follow-bottom。
- READY 后正常态 `scrollHeight` 不超过 physical cap；exceptional-row 例外但必须有诊断。

关键断言：

```text
bootstrapState MOUNTING/MEASURING/STABILIZING 权限不越界
viewport 内没有 spacer-only 空洞
safe scroll range 内 realRowCoveragePx >= minRealRowCoveragePx
latest LOCKED 只在 hasMoreAfter=false 且 active segment latest 时成立
```

### B. Segment Shift

覆盖：

- wheel 到 top threshold 触发 shift-before。
- wheel 到 bottom threshold 触发 shift-after。
- target data 缺失进入 `READY_SEGMENT_SHIFT_PENDING`。
- prefetch band 提前发起相邻 segment 数据需求。
- data 到达后 pending shift 优先消费。
- shift commit 后 rebase 到安全区，不立即二次 shift。

关键断言：

```text
rows + spacers 同一 projection commit
ProjectionCommitToken 匹配后才测量和提交 metrics
physicalSegmentRevision 递增
normal cap 保持，exceptional-row 需有 diagnostic
viewport 不白屏
```

### C. Drag

覆盖：

- thumb drag 期间 `isDragLocked=true`。
- drag 到边界只记录 shift intent，不执行 shift。
- pointerup 后执行 pending shift。
- shift commit 前 thumb freeze，commit 后同步新 metrics。
- drag 期间 motion / resize correction 不能抢写。
- pendingEdgeOverflowPx 可观测。

关键断言：

```text
thumb geometry 与 data item count 无关
direct scroll delta 线性映射到 current physical segment
```

### D. Segment Relayout

覆盖：

- container width 改变导致 row wrap。
- mounted row height 大幅增长。
- 单条超大消息超过 configured cap。
- same revision spacer oscillation。
- measurement delta 由 spacer 反向吸收，不能改变同 revision 的 physicalWindowHeight。

关键断言：

```text
relayout 不跨 segment
relayout 不改变 logicalSegmentId / logicalRole / logicalAnchorKey
relayout 不自动发 pagination
coverage/cap 恢复
capExceededByRow 有诊断
```

### E. Jump / Restore

覆盖：

- 目标已在 DataWindow 内。
- 目标缺失，发 `needMessagesAround`。
- 数据到达后构造 target segment。
- target segment 内做局部 anchor correction。

关键断言：

```text
不使用全局 scrollHeight 动画
motion 只发生在 target segment 内
```

### F. Follow Bottom

覆盖：

- 当前 hasMoreAfter=true，followBottom 进入 pending latest。
- latest data 到达后由 READY_FOLLOW_BOTTOM_PENDING 优先消费并构造 latest segment。
- motion settle 后才 `LOCKED`。
- history segment physical bottom 不会 `LOCKED`。

### G. Edge Need

覆盖：

- edge latch key 包含 data revision + physical segment id/revision + edge。
- segment relayout 后旧 edge intent 不误触发。
- drag edge intent 不重复发同一页请求。
- pending shift 目标数据到达后不重复 needMore。
- adjacent prefetch in-flight 时不重复发同一 edge need。

### H. Wheel / Momentum

覆盖：

- trackpad momentum 到边界只排队一次 shift。
- residual delta 被 `suppressedMomentumDeltaPx` 记录并默认丢弃。
- shift commit 后至少一帧 safe zone 稳定再释放 latch。
- macOS overscroll bounce 不触发反向 shift loop。

### I. Diagnostics

覆盖：

- 每次 segment shift / relayout 输出 segment id/revision。
- 同一 data revision spacer 震荡被检测。
- scrollHeight 超 cap 被检测。
- `physicalWindowHeight === domScrollHeight`、总高度守恒和 `maxScrollPosition` 派生关系被检测。
- `scrollHeightCap`、`capMode`、`safeScrollRangeStart/End`、`realRowCoveragePx`、`minRealRowCoveragePx` 是一等字段。
- `isThumbFrozen`、`isMomentumLatched`、`suppressedMomentumDeltaPx`、`segmentRelayoutState/reason` 是一等字段。
- `adjacentPrefetchBefore/After` 是一等字段。
- thumb geometry 不能由 DataWindow 长度驱动。
- drag lock 期间其他 writer 被拒绝或取消。

## 7. Browser Integration Notes

真实浏览器验证必须使用实际 layout、ResizeObserver、IntersectionObserver 和 pointer events。纯 fake DOM 只能覆盖状态机，不足以证明：

- row height measurement
- thumb freeze 视觉连续性
- scrollHeight cap
- spacer-only viewport
- safe scroll range coverage
- wheel / trackpad momentum latch
- pointer capture / release timing

浏览器验证不需要先写完整自动化，但每次实现 segment shift、drag lock、relayout 后都必须人工或自动确认这些视觉不变量。
