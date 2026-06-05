# 性能与可观测性

## 性能目标

| 操作 | 目标 |
| --- | --- |
| scroll frame runtime work | <= 1ms typical |
| edge trigger to need event | <= 1 rAF |
| segment extend commit correction | <= 2 frames after data ready |
| visible anchor delta after correction | <= 1px |
| large segment trim | no long task > 50ms |

## Hot Path 规则

Scroll event 中只允许：

- 记录 dirty scroll flag。
- schedule rAF。
- 保存输入 source token。

Scroll rAF 中允许：

- 读 native metrics。
- 用最近一次 transaction / resize 记录的 row metrics 推导有界 visible-anchor sample。
- 更新 edge trigger state。
- 发布 throttled observation。
- 发布 `viewportAnchorChanged(reason: 'scroll-idle')`，但不发布 React snapshot。

Scroll rAF 中避免：

- 全量 query rows。
- 遍历全部 row 后读取 DOM rect。
- React setState。
- 同步大数组 diff。
- 写 scrollTop，除非当前 rAF 是 transaction correction。

## Measurement 策略

- row height cache 只用于预算和 resize 判断，不用于生成 DOM spacer。
- loaded segment 内部维护 shadow measurement cache，字段包含 key、height、top、bottom、width bucket、renderVersion、generation、segmentRevision、projectionRevision、dirty 和 source。
- cache key 至少要区分 sessionId、generation、width bucket 和 renderVersion，避免跨 session、跨布局或内容版本污染。
- cache 只优化 DOM 读数、scroll sample、restore hint 和 diagnostics，不拥有 scrollTop correction。
- measurement snapshot 留在 session registry 内部，生命周期跟 session keepAlive 一致；restore/attach 后仍以真实 DOM rect + anchor correction 为准。
- snapshot 永不参与 scrollHeight、thumb ratio 或 unloaded height。
- ResizeObserver 只作为 dirty signal；dirty range 不完整、key/index 缺失、anchor missing 或 unknown 时回退 full measure。
- IntersectionObserver 只作为 edge / visibility signal。
- DOM rect read 和 scrollTop write 必须读写分批。
- ordinary scroll rAF 只能读取 native container metrics 和少量 sampled row rect；完整 row measurement 只属于 transaction commit、resize dirty 或显式 profiling 路径。
- local programmatic scroll 写入 `scrollTop` 后必须 schedule rAF 刷新 evidence / observation，不能等待下一次用户 scroll 或 resize。

Dirty correction 规则：

- dirty below anchor：只更新 cache，不做 anchor correction。
- dirty above anchor：走 `preserveVisualAnchor`。
- dirty contains anchor：走当前 anchor correction path。
- unknown dirty：回退旧 full measure path。

Custom scrollbar overlay 规则：

- overlay refresh reason 统一为 `scroll`、`projection`、`resize`、`mutation`、`drag`。
- overlay refresh 只读取 `scrollTop/clientHeight/scrollHeight`。
- drag pointermove 热路径不写 React state，只直接写 native scrollTop 和 thumb transform。
- mutation refresh 必须按 rAF batch；优先 observe message flow childList，subtree 只作 fallback。
- mismatch report 限频到每 session 每秒最多 2 次。

禁止：

- 用 estimate / median size / cached total height 生成 native scroll range。
- 在 ResizeObserver、IntersectionObserver、React effect 或 overlay 中直接拥有 correction。
- 在没有 profile 证明前引入 recycler pool 作为 core 优化。

## Segment Budget

默认建议：

- min segment items：40
- target segment items：80-120
- hard segment items：200-300
- anchor protection：viewport 上下至少 1.5 屏真实 DOM

预算是内部策略，不是公开配置的滚动语义。即使预算变化，用户交互 specs 也不变。

## Diagnostics

必须覆盖：

- `projection.publish`
- `transaction.start/commit/measure/correct/settle`
- `anchor.capture`
- `anchor.correction`
- `edge.need`
- `edge.latch`
- `scroll.source`
- `bottom.lock`
- `destination.pending/settle/cancel`
- `segment.trim`
- `commit.timeout`
- `measurement.cache.hit/miss/invalidate`
- `measurement.rectRead.count`
- `measurement.rectRead.rows`
- `measurement.transaction.latencyMs`
- `measurement.resize.dirtyKeys`
- `measurement.resize.fallbackFullMeasure`
- `overlay.refresh.count`
- `overlay.mutation.batch`
- `overlay.drag.rebase.count`
- `blank-area.sample`
- `frame-gap.sample`

Diagnostics 要带：

- sessionId
- generation
- segment revision
- projection revision
- commit token or request token
- transaction id
- modifier
- hasMoreBefore / hasMoreAfter
- scroll source
- anchor key
- delta / measured count
- cache key / invalidation reason when measurement cache participates

## Evidence Hooks

E2E harness 需要能读取：

- visible row runtime keys, row kinds, optional identities and rects
- scrollTop/clientHeight/scrollHeight
- hasMoreBefore/hasMoreAfter, modifier, generation, segmentRevision, projectionRevision
- bottomLockState and pendingIntent
- edge trigger rects
- bottom marker rect
- runtime phase/state
- recent viewport events
- recent diagnostics

禁止把 internal private object 直接暴露给测试。测试读的是稳定 evidence API。

## Failure Posture

宁可暴露错误，不要静默跳动：

- anchor missing -> diagnostic + fallback
- commit timeout -> viewportError
- stale generation -> drop + diagnostic
- duplicate edge request -> latch diagnostic
- overlay metric mismatch -> warning
