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
- visible rows 包含最新消息。
- 无 `commit-timeout-bootstrap`。
- console error 为 0。

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
- `needMoreBefore` 不重复异常触发。
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

### 3.2 `destination.quote-jump-visible-target`

目的：点击 quote 后目标消息可见，settle 和 highlight 一致。

Actions:

1. 打开含 quote 的中部窗口。
2. 点击当前可见 quote。
3. wait idle。
4. collect evidence。

Oracle:

- `expectDestinationSettledOnTarget`
- highlighted message id 与 resolved target 一致。
- target row 不应错位到不可见区域。

### 3.3 `dynamic-height.anchor-above-growth`

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

### 3.4 `session.switch-restore-runtime-cache`

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

## 4. P2 Scenarios

### 4.1 `edge.custom-scrollbar-drag-top`

目的：custom scrollbar drag 到顶部边缘时，只在 direct user intent 下触发 before edge。

Oracle:

- `needMoreBefore` 只触发一次或符合场景预期。
- recovery scroll 不释放 edge latch。
- drag end 后 intent 清理。

### 4.2 `edge.custom-scrollbar-drag-bottom`

目的：custom scrollbar drag 到底部边缘时，after edge / follow bottom 状态不互相污染。

Oracle:

- partial DataWindow 不伪装成 true bottom locked。
- `needMoreAfter` 只在有更多 newer data 且用户意图存在时触发。

### 4.3 `lifecycle.strictmode-attach-detach-attach`

目的：StrictMode 模拟 cleanup 不导致 observer 重复、runtime 销毁或 commit 丢失。

Oracle:

- observed rows 数量合理。
- 没有 stale generation callback 修改当前 feed。
- no duplicate viewportAnchorChanged detach for same real unmount。

### 4.4 `recovery.bootstrap-commit-timeout`

目的：commit timeout recovery 后，runtime 不留在中间态，sentinel 不误触发 edge need。

Oracle:

- recovery 后状态稳定。
- `viewportError` 可观测。
- no unintended `needMoreBefore` / `needMoreAfter`。

## 5. P3 AI Stress Scenarios

### 5.1 `storm.quote-jump-during-event-storm`

目的：Event Storm 中点击 quote，验证 destination 仍可 settle 或可解释地取消。

AI role:

- AI 可以探索不同 quote 和 timing。
- 必须输出最短复现。

Oracle:

- no white screen。
- no stuck transaction。
- destination settle / cancel 有明确 evidence。

### 5.2 `storm.follow-bottom-with-bot-push`

目的：Bot Push 和 followBottom 混跑时，不抢滚、不丢 bottom affordance。

Oracle:

- 用户阅读历史时不被 bot push 拉到底。
- 用户明确 follow bottom 后必须追到底。

### 5.3 `storm.dynamic-height-session-switch`

目的：动态高度 + 会话切换组合下，旧 observer 不污染新 feed。

Oracle:

- no feed pollution。
- no stale ResizeObserver error。
- restored feed anchor 合理。

## 6. Scenario Definition Template

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

## 7. Scope Control

新增场景必须满足至少一个条件：

- 覆盖 IM 用户关键路径。
- 覆盖 runtime 状态机关键边。
- 覆盖已修复回归。
- 能显著提升 AI agent 复现和归因效率。

不要为了“测试多”而添加低价值场景。

