# Scenario Matrix

## 1. Priority Model

| Priority | Meaning | Gate |
| --- | --- | --- |
| P0 | 最小可用 IM 消息列表合同 | 每次 e2e smoke 必跑 |
| P1 | 核心 IM 交互稳定性 | 功能改动、runtime 改动必跑 |
| P2 | 并发、动态高度、复杂恢复 | 发布前或相关改动必跑 |
| P3 | 探索性 / AI stress | 用于发现问题，不作为基础门禁 |

## 2. P0 Scenarios

### 2.1 `bootstrap.latest-bottom-lock`

目的：验证 latest bootstrap 后进入最新消息视图。

Initial state:

- feed 有足够消息形成滚动。
- runtime 尚未 attach。
- data snapshot latest 先到或 attach 后到都要可覆盖。

Actions:

1. `resetScenario('bootstrap.latest-bottom-lock')`
2. `wait_for_ready`
3. `collect_evidence`

Oracle:

- `expectRuntimeIdle`
- `expectBottomLocked`
- `expectLatestMessageVisible`
- `expectNoUnexpectedErrors`

### 2.2 `paging.prepend-anchor-preservation`

目的：用户阅读历史时加载更早消息，阅读位置不跳。

Actions:

1. `resetScenario('paging.prepend-anchor-preservation')`
2. `wait_for_ready`
3. `scroll_to_middle`
4. `collect_evidence` as before
5. `scroll_to_history_top` 或 `prepend_history`
6. `wait_for_idle`
7. `collect_evidence` as after

Oracle:

- `expectRuntimeIdle`
- `expectAnchorPreserved(before, after, { tolerancePx: 1 })`
- `expectNeedMoreBeforeWithin(after, 1)`
- `expectNoUnexpectedErrors`
- recovery/programmatic scroll 不被误判为用户 edge intent。

### 2.3 `bottom.user-scroll-up-append-no-follow`

目的：用户离开底部阅读历史时，新消息不会抢滚。

Actions:

1. `resetScenario('bottom.user-scroll-up-append-no-follow')`
2. `wait_for_ready`
3. `scroll_to_middle`
4. `collect_evidence` as before
5. `append_message`
6. `wait_for_idle`
7. `collect_evidence` as after

Oracle:

- `expectRuntimeIdle`
- `expectNoFollowWhenUserReading`
- `bottomLockState === 'UNLOCKED'`
- follow-bottom affordance 可见。
- `expectNoUnexpectedErrors`

## 3. P1 Scenarios

### 3.1 `bottom.locked-append-follow`

目的：锁底时 append 必须追到底。

Actions:

1. latest bootstrap。
2. collect before。
3. append message。
4. wait idle。
5. collect after。

Oracle:

- `expectBottomLocked`
- 新消息可见。
- append 后不出现 transient wrong bottom button state。
- `expectNoUnexpectedErrors`

### 3.2 `destination.quote-jump-visible-target`

目的：点击 quote 后目标消息可见，settle 和 highlight 一致。

Actions:

1. 使用 e2e seed 中 latest window 的 deterministic quote band。
2. 点击当前可见 quote。
3. wait idle。
4. collect evidence。

Oracle:

- `expectDestinationSettledOnTarget`
- highlighted message id 与 resolved target 一致。
- target row 不应错位到不可见区域。
- `expectNoUnexpectedErrors`

### 3.3 `destination.quote-jump-unloaded-target`

目的：latest 可见 quote 指向未加载历史消息时，runtime 必须发起 around-target 请求，并最终 settle/highlight 到目标。

Actions:

1. 使用 e2e seed 中 latest window 的 deterministic unloaded quote。
2. 点击当前可见 quote。
3. wait idle。
4. collect evidence。

Oracle:

- `expectNeedMessagesAroundObserved(after, { reason: 'jump' })`
- `expectDestinationSettledOnTarget`
- target row 可见且 highlighted message id 一致。
- `expectNoUnexpectedErrors`

### 3.4 `send.optimistic-ack-follow-bottom`

目的：发送消息先出现 optimistic row，ack 后通过 `identity-remap` 变成 committed row，并保持锁底。

Actions:

1. latest bootstrap。
2. `send_message({ body, waitFor: 'optimistic' })` collect during。
3. wait idle。
4. collect after。

Oracle:

- during: `expectVisibleOptimisticRow`
- after: `expectNoOptimisticRows`
- after: `expectBottomLocked`
- after: `expectLatestMessageVisible`
- `expectNoUnexpectedErrors`

### 3.5 `send.optimistic-fail-retry`

目的：发送失败后保留 failed optimistic row，retry 使用同一 optimistic key，成功 ack 后再通过 `identity-remap` 变成 committed row。

Actions:

1. latest bootstrap。
2. `send_message({ body, waitFor: 'failed' })`。
3. wait idle。
4. collect failed。
5. `retry_failed_send({ waitFor: 'optimistic' })` collect retrying。
6. wait idle。
7. collect after。

Oracle:

- failed: `expectVisibleOptimisticRow({ status: 'failed' })`
- failed: 不出现超过当前 feed message count 的 committed row。
- retrying: `expectVisibleOptimisticRow({ status: 'sending' })`
- retrying: optimistic serializedKey 与 failed 阶段一致。
- after: `expectNoOptimisticRows`
- after: `expectBottomLocked` 和 `expectLatestMessageVisible`
- `expectNoUnexpectedErrors`

### 3.6 `dynamic-height.anchor-above-growth`

目的：anchor 上方异步内容增高后，阅读位置保持。

Actions:

1. scroll to middle。
2. collect before anchor。
3. toggle dynamic height 或触发 media load。
4. wait idle。
5. collect after。

Oracle:

- anchor delta <= 1px。
- 发生 `correction.anchorPreserved` diagnostic。
- scroll correction 不触发 edge paging。
- `expectNoUnexpectedErrors`

### 3.7 `session.switch-restore-runtime-cache`

目的：feed A 中部切到 B，再切回 A，恢复 projection / anchor / height cache。

Actions:

1. feed A scroll to middle。
2. collect A before。
3. switch feed B。
4. wait ready。
5. switch feed A。
6. wait ready。
7. collect A after。

Oracle:

- `expectNoFeedPollution`
- A 的 restored visible range 接近 before。
- feed B 的 events 不污染 A。
- detach anchor event 被 host 接收。
- `expectNoUnexpectedErrors`

## 4. P2 Scenarios

### 4.1 `edge.custom-scrollbar-drag-top`

目的：custom scrollbar drag 到顶部边缘时，只在 direct user intent 下触发 before edge。

Oracle:

- `needMoreBefore` 只触发一次或符合场景预期。
- recovery scroll 不释放 edge latch。
- drag end 后 intent 清理。
- `expectNoUnexpectedErrors`

### 4.2 `edge.custom-scrollbar-drag-bottom`

目的：custom scrollbar drag 到底部边缘时，after edge / follow bottom 状态不互相污染。

Oracle:

- partial DataWindow 不伪装成 true bottom locked。
- `needMoreAfter` 只在有更多 newer data 且用户意图存在时触发。
- `expectNoUnexpectedErrors`

### 4.3 `paging.prepend-slow-request-race`

目的：before 分页慢请求未完成时重复触顶/触发 prepend，host 只能发起一次有效 before edge，并保持 anchor。

Actions:

1. scroll to middle。
2. collect before。
3. `start_prepend_history`，只等到 `loadingBefore` / `history.prepend` pending。
4. pending 期间再次 `prepend_history`，验证 host/runtime 不发起重复有效请求。
5. collect after。

Oracle:

- `expectAnchorPreserved(before, after, { tolerancePx: 1 })`
- `expectNeedMoreBeforeWithin(after, 1)`
- `expectLoadedMessageCountDelta(before, after, 20)`
- `expectNoUnexpectedErrors`

### 4.4 `paging.append-slow-request-race`

目的：after/newer 分页慢请求未完成时重复触发 append，host 只能发起一次有效 after edge，并保持当前 anchor。

Initial state:

- 通过 unloaded quote jump 进入 partial middle window，确保 `hasMoreAfter=true`。

Actions:

1. latest bootstrap。
2. `jump_to_quoted_message` 进入 around-target 中间窗口。
3. wait idle。
4. collect before。
5. `start_append_history`，只等到 `loadingAfter` / `history.append` pending。
6. pending 期间再次 `append_history`。
7. collect after。

Oracle:

- `expectAnchorPreserved(before, after, { tolerancePx: 1 })`
- `expectNeedMoreAfterWithin(after, 1)`
- `expectLoadedMessageCountDelta(before, after, 20)`
- `expectNoUnexpectedErrors`

### 4.5 `destination.quote-jump-deleted-target`

目的：quote 指向已删除但仍带 position 的历史消息时，runtime 发起 around-target 请求并 settle 到 nearby fallback，不高亮原 target。

Actions:

1. 使用 e2e seed 中 latest 可见 deleted quote。
2. 点击当前可见 quote。
3. wait idle。
4. collect after。

Oracle:

- `expectNeedMessagesAroundObserved(after, { reason: 'jump' })`
- `destinationSettled.resolution === 'fallback-deleted'`
- resolved fallback target 可见。
- `highlightedMessageId === null`
- `expectNoUnexpectedErrors`

### 4.6 `session.switch-during-pending-prepend`

目的：before 分页 pending 时立即切会话，旧 feed 的迟到请求不能污染新 active feed。

Actions:

1. feed A scroll to middle。
2. `start_prepend_history` 进入 pending。
3. `switch_feed({ feedId: 'feed-release' })`。
4. collect after。

Oracle:

- active feed 是 `feed-release`。
- visible committed rows 均属于 active feed。
- runtime idle。
- `expectNoUnexpectedErrors`

### 4.7 `lifecycle.strictmode-attach-detach-attach`

目的：StrictMode 模拟 cleanup 不导致 observer 重复、runtime 销毁或 commit 丢失。

Action 必须通过 React projection remount 触发 detach/attach，不能只调用
`runtime.detach()` / `runtime.attach()` 绕过 row ref 注册链路。

Oracle:

- observed rows 数量合理。
- 没有 stale generation callback 修改当前 feed。
- no duplicate viewportAnchorChanged detach for same real unmount。
- `expectNoUnexpectedErrors`

### 4.8 `recovery.bootstrap-commit-timeout`

目的：commit timeout recovery 后，runtime 不留在中间态，sentinel 不误触发 edge need。

e2e host 需要显式注入一次 bootstrap commit timeout，例如丢弃首个 bootstrap
commit ack 后再触发一次 latest bootstrap retry。

Oracle:

- recovery 后状态稳定。
- `viewportError` 可观测。
- no unintended `needMoreBefore` / `needMoreAfter`。
- `expectNoUnexpectedErrors(after, { allowedViewportErrors: ['commit-timeout-bootstrap'] })`

## 5. P3 AI Stress Scenarios

### 5.1 `storm.quote-jump-during-event-storm`

目的：Event Storm 中点击 quote，验证 destination 仍可 settle 或可解释地取消。

AI role:

- AI 可以探索不同 quote 和 timing。
- Event Storm 启动后 `pendingOperation` 会保持 `mock.eventStorm`，中途语义动作只等待 runtime 稳定。
- 场景收尾必须显式停止 Event Storm，再执行最终 `wait_for_idle`。
- 必须输出最短复现。

Oracle:

- no white screen。
- no stuck transaction。
- destination settle / cancel 有明确 evidence。

### 5.2 `storm.follow-bottom-with-bot-push`

目的：Bot Push 和 followBottom 混跑时，不抢滚、不丢 bottom affordance。

Bot Push 启动后 `pendingOperation` 会保持 `mock.botPush`，followBottom 执行完后
必须显式停止 Bot Push，再进入最终 idle oracle。

Oracle:

- 用户阅读历史时不被 bot push 拉到底。
- 用户明确 follow bottom 后必须追到底。

### 5.3 `storm.dynamic-height-session-switch`

目的：动态高度 + 会话切换组合下，旧 observer 不污染新 feed。

Oracle:

- no feed pollution。
- no stale ResizeObserver error。
- restored feed anchor 合理。

## 6. Performance Scenarios

性能场景使用独立 `perf` priority，默认不进入 correctness `--priority all`。它们只验证相对稳定的首批预算：action latency、Long Task、frame gap，不引入复杂 trace 或真实用户硬件预算。

### 6.1 `perf.bootstrap-latest-budget`

目的：latest bootstrap 不出现明显主线程阻塞，且 ready latency 保持在本地开发可接受范围。

Oracle:

- `expectActionDurationWithin(final, 'wait_for_ready', 2500)`
- `expectNoLongTasks(final, { thresholdMs: 100, maxCount: 0 })`
- `expectFrameGapWithin(final, 250)`
- 同时复用 bootstrap correctness oracle。

### 6.2 `perf.send-ack-latency-budget`

目的：发送消息的 optimistic 阶段和 ack settle 阶段都保持响应，不因 identity-remap 或 bottom follow 引入明显卡顿。

Oracle:

- during: `expectActionDurationWithin(during, 'send_message', 500)`
- after: `expectActionDurationWithin(after, 'wait_for_idle', 1500)`
- after: `expectNoLongTasks(after, { thresholdMs: 100, maxCount: 0 })`
- after: `expectFrameGapWithin(after, 250)`
- 同时复用 optimistic send correctness oracle。

### 6.3 `perf.prepend-latency-budget`

目的：普通 before 分页、DOM commit、measurement、anchor correction 的端到端耗时保持在预算内。

Oracle:

- `expectActionDurationWithin(after, 'prepend_history', 1500)`
- `expectNoLongTasks(after, { thresholdMs: 100, maxCount: 0 })`
- `expectFrameGapWithin(after, 250)`
- 同时复用 anchor preserved / loaded delta oracle。

## 7. Scenario Definition Template

```md
# <scenario-id>

Priority: P0
Owner: runtime state machine
Tags: bootstrap, bottom-lock

## Goal
...

## Initial State
...

## Allowed Actions
...

## Evidence Checkpoints
- before
- after

## Oracle
...

## Failure Triage Hints
...
```

## 8. Scope Control

新增场景必须满足至少一个条件：

- 覆盖 IM 用户关键路径。
- 覆盖 runtime 状态机关键边。
- 覆盖已修复回归。
- 能显著提升 AI agent 复现和归因效率。

不要为了“测试多”而添加低价值场景。
