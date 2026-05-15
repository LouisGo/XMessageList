# Lifecycle 与测试合同

## 1. Scope

本文定义 runtime 生命周期、generation safety、异步资源清理和测试矩阵。

## 2. Generation Contract

每个 runtime 实例都必须带：

```text
RuntimeGeneration {
  feedId
  generation
}
```

所有异步回调必须捕获 generation：

- projection commit ack。
- frame callback。
- timeout。
- height change callback。
- edge signal callback。
- data snapshot response。
- external event callback。

执行前先检查：

```text
if generation is not current -> return
```

## 3. Attach / Detach / Destroy

`attach(host)`：

- 保存 projection host。
- 注册 scroll signal。
- 注册 viewport size signal。
- 如已有 snapshot 且未 READY，继续 bootstrap。

`detach()`：

- 在清理 materialized row handles 前 capture 当前 viewport anchor，并发出
  `viewportAnchorChanged(reason: detach)`。
- 保存当前 scroll offset，供同一 runtime 再次 attach 时恢复。
- 移除 scroll signal。
- 取消 frame callback。
- 清理 materialized row handles。
- clear pending commit。
- 保留 feed generation、anchor、projection snapshot 和可复用 height cache。

`destroy()`：

- 调用 detach。
- 清空 command queue。
- 清空 height cache。
- 清空 row registry。
- 清空 snapshot listeners。
- 标记 DESTROYED。

`detach` 用于 projection 临时卸载；`destroy` 用于 runtime 彻底废弃。

## 4. Feed Runtime Cache

生产级 IM 页面不应把 viewport runtime 绑定到单个 projection 组件生命周期。

合理 ownership：

- session host 按 feedId 持有 runtime cache。
- projection shell 只接收当前 active runtime。
- feed 切走时 projection 对旧 runtime 执行 detach，保留 height cache、anchor、
  scroll offset 和 projection snapshot。
- feed 切回且 runtime cache 命中时，不重新 bootstrap 同一 runtime。
- feed cache miss 时，host 采用 staged activation：先保留当前 active projection，
  准备目标 feed data window，并对目标 runtime 完成 snapshot + bootstrap 后再切换。
- LRU 淘汰、显式关闭会话或页面最终销毁时，host 才调用 destroy。

## 5. Cleanup Order

推荐 teardown 顺序：

```text
mark generation inactive
-> stop accepting commands
-> cancel pending commit timeout
-> cancel frame callbacks
-> remove signals/listeners
-> clear row handles
-> publish terminal or reset snapshot if needed
```

先 mark inactive，可以阻止清理过程中排队的旧回调继续修改状态。

## 6. Command Queue Safety

```text
QueuedCommand {
  id
  generation
  command
  supersedeKey?
}
```

规则：

- later jump supersedes earlier pending jump。
- reset supersedes all pending commands。
- generation change drops all pending commands。
- destroyed state rejects all commands。
- detached state queues only bootstrap / reset if host policy allows it。

## 7. Measurement Safety

Row measurement：

- 只跟踪当前 materialized row。
- row unmounted 时注销 handle。
- callback 不持有业务 cell state。

Edge signal：

- 只作为 prefetch / edge proximity signal。
- detach 时取消。

Viewport size signal：

- width bucket 变化触发 height cache invalidation。
- height 变化触发 window threshold 重算。

## 8. Error Recovery

| Error | Recovery |
| --- | --- |
| commit timeout | cancel transaction, retry projection once or request reset |
| anchor missing | nearest visible fallback, then reset if unavailable |
| row registry inconsistent | force projection revision, wait commit |
| stale generation callback | discard |

Runtime 不吞掉不可恢复错误。它发布 `viewportError`，由上层决定显示恢复 UI 还是重建
runtime。

## 9. Unit Test Harness

纯 runtime 测试应提供 fake platform adapter：

- fake viewport metrics。
- fake row measurement registry。
- fake frame scheduler。
- fake height change events。
- fake commit ack。

可测：

- command queue supersede。
- generation stale discard。
- extent estimation。
- identity rebind cache migration。
- bottom lock hysteresis。
- snapshot revision 粒度。
- pending follow bottom / destination command。

## 10. Integration Test Scenarios

必须覆盖：

1. latest bootstrap 后处于 bottom locked。
2. 高视口 + 稀疏消息时，latest / followBottom window 不退化成只挂最小条数。
3. prepend 动态高度消息后，目标 anchor 视觉位置不变。
4. 图片或富文本高度增长时，anchor 上方变化会补偿滚动位置。
5. bottom locked 时 append 新消息，下一帧内保持底部可见。
6. user scroll up 后 append 新消息，不追底。
7. jump 到历史消息，目标消息可见且有上下文。
8. feed 切换后旧 generation callback 不污染新 feed。
9. runtime cache 命中时切回 feed 不丢失 projection / height cache。
10. runtime cache 淘汰后必须 destroy，再切回走新 runtime + restore/latest。
11. pending restored bootstrap 先于 projection attach 时，attach 后必须完成 commit ack
    并进入 READY。
12. bootstrap recovery 后 edge signal 不得误触发 before / after pagination。

## 11. Test Assertions

优先断言 observable behavior：

```text
anchorTopAfter closeTo anchorTopBefore
distanceToBottom <= lockThreshold
snapshot.materializedWindow contains targetKey
```

避免以私有字段作为主要合同。

## 12. Debug Instrumentation

开发环境建议提供：

```text
RuntimeDebugSnapshot {
  state
  activeTransaction?
  pendingCommands
  materializedRows
  heightCacheSize
  lastScrollSource?
  lastCorrectionExtent?
}
```

Debug snapshot 不进入 projection snapshot。

## 13. Performance Budgets

初始预算：

| Scenario | Budget |
| --- | --- |
| scroll handler | < 2ms per frame |
| prepend correction | same frame after commit |
| bottom follow | <= 1 frame after commit |
| height change batch | coalesced per frame |

超过预算时优先检查：

- 是否在 scroll signal 内同步测量过多 row。
- 是否把 height cache 更新推入 projection state。
- 是否频繁重建 measurement handles。
- 是否 trim 太激进导致反复 materialize。
