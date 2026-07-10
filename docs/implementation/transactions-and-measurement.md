# Transactions 与 Measurement

## Transaction 通用流程

```text
capture visual anchor
-> consume immutable next segment snapshot from loaded segment store
-> publish projection snapshot
-> wait React commit ack
-> measure committed DOM
-> correct scrollTop from anchor rect delta
-> settle edge/bottom/destination state
-> emit viewportAnchorChanged(transaction-settle)
```

关键规则：

- capture 和 correction 必须在同一个 transaction 语义内。
- commit ack 前不能读取新 row rect。
- correction 写入必须标记 scroll source。
- settle 后才能释放对应 pending intent。
- viewport runtime 不创建、合并、删除或去重 `items`；它只根据 `modifier` 选择 anchor capture 和 correction 策略。

## Anchor Correction

```ts
const delta = anchorRectAfter.top - anchorRectBefore.top;
container.scrollTop += delta;
```

如果 anchor row 不存在：

1. 等一帧，允许 React ref callback 补注册。
2. 查找同 segment 中最近可测 row。
3. 如果仍失败，发 `viewportError`，进入 reset recovery。

## Extend Before

```text
capture first stable visible row
-> receive extend-before segment from loaded segment store
-> publish projection snapshot
-> commit
-> measure
-> scrollTop += newAnchorTop - oldAnchorTop
```

注意：

- 浏览器 native scrollHeight 会因为真实新增 DOM 增大。
- correction 后 thumb 自然离开顶部。
- before trigger 的 IntersectionObserver 迟到 entries 必须在 transaction 期间被抑制。

## Extend After

Unlocked：

```text
capture current visual anchor
-> receive extend-after segment from loaded segment store
-> publish projection snapshot
-> commit
-> preserve anchor
```

Locked / Follow：

```text
receive extend-after, append(follow), explicit bottom intent, or locked patch segment from loaded segment store
-> publish projection snapshot
-> commit
-> measure bottom marker
-> start bounded bottom motion or settle native bottom
```

`hasMoreAfter=true` 时不得进入 locked bottom。

Receive append 不复用普通 patch 语义。`append(follow)` 表示接入策略允许追底，
runtime 保留 bottom motion；`append(preserve)` 表示新消息已进入 latest tail，
但本次必须保持阅读位置并退出 bottom lock。显式 bottom intent 是更高优先级的
用户命令：如果 append preserve 与 bottom 点击并发，事务结算必须继续吸底。

普通 locked patch 只负责维持 bottom lock，不拥有“新尾部消息”的 after 语义；
因此不得为了 retrying、status、reaction 等状态更新播放 append-style bottom
motion。

## Reset Around / Latest

Reset 会消费 loaded segment store 返回的整个 next segment：

- around reset 对齐目标 row。
- latest reset 对齐 bottom。
- reset 期间禁用 edge need。
- reset 后旧 scrollTop 没有意义，必须由 identity/visual target 重新确定。

### Structural Reload Draft

`reloadCurrent` 不直接覆盖主 loaded segment。它先在内部 draft store 上构造 reset 和
trim projection，再把该 projection 作为可取消 transaction 交给 runtime：

```text
capture old committed segment
-> request + journal rebase into draft store
-> publish cancellable React projection
-> React commit ack: CAS adopt draft before measurement
-> measure + one correction + settle
-> expose new committed segment and resolve applied
```

ack 前发生 timeout、用户导航、supersede、destroy 或新的 authoritative mutation 时，runtime
恢复旧 projection 并丢弃 draft；不允许为已 stale 的 reload 读取新 DOM 或写 `scrollTop`。

## Segment Trim

Trim 是 transaction，不是数组静默裁剪：

```text
capture visual anchor
-> receive trim-before/trim-after segment from loaded segment store
-> publish projection snapshot
-> commit
-> measure
-> preserve anchor
```

当 trim 与 extend/reset/append 同时发生时，segment 保留原主 modifier，并额外携带 trim
effect。主 modifier 决定滚动和 anchor 策略；trim effect 负责 edge latch 重开及 metric 清理。

Trim 策略：

- viewport runtime 可以上报 trim pressure：anchor 上下真实 DOM 距离、item count、estimated DOM cost。
- loaded segment store 根据 trim pressure 和业务保护区决定是否发布 trim segment。
- 正在 follow bottom locked 时，loaded segment store 只能发布 trim-before。
- 正在 read middle 时，loaded segment store 不能裁掉 anchor 附近保护区。

## Identity Remap

```text
capture current visual anchor by key and identity
-> receive identity-remap segment from loaded segment store
-> resolve old anchor key through remap table
-> publish projection snapshot
-> commit
-> measure next key
-> preserve anchor
```

规则：

- 同 key remap 只更新 identity metadata，不应造成 row unmount。
- 换 key remap 必须通过 modifier 提供 `previousKey -> nextKey`；否则 anchor missing 是 data contract error。
- remap settle 后，`viewportAnchorChanged` 必须发布 remap 后的 identity。

## Resize Stabilization

Resize 来源：

- container width / height 变化
- font / density / theme
- media decode
- markdown lazy render

流程：

```text
mark dirty
-> schedule stabilization rAF
-> capture current anchor
-> measure dirty rows
-> correct if dirty area affects anchor
```

ResizeObserver callback 禁止直接写 `scrollTop`。

## Commit Timeout

如果 projection 发布后没有 commit ack：

- transaction 进入 timeout recovery。
- 发布 `viewportError(code: 'commit-timeout')`。
- 不继续写 scrollTop。
- host 可以选择 reset 当前 runtime 或重放 snapshot。

Timeout 不是边缘分页失败，不能释放 edge latch 后立即重试同一页。
