# Next 分支实施路线

本文档只描述文档定稿后的实施阶段。当前任务停止点是：文档足以作为开工依据，不写 runtime 代码。

## Phase 0 文档冻结

退出标准：

- `docs/` 不再以 spacer 作为正向机制。
- architecture / interaction / implementation / testing 职责不重复。
- 滚动、滚动条、分页、follow bottom、jump、restore 都有明确 specs。
- projection snapshot / evidence shape 包含 hasMoreBefore/After、modifier、generation、revision/token、bottomLockState 和 pendingIntent。
- 短 segment / 双边 underflow 有仲裁策略和 oracle。
- identity / runtime key / local-to-server remap 有完整合同。
- Telegram Web A 的参考与取舍写清楚。

## Phase 1 Contract Rewrite

目标：

- 修改 runtime snapshot contract。
- 删除 renderWindow/spacer public projection 字段。
- 引入 loaded segment modifiers、identity-remap 和 commit token。
- 更新 events 和 diagnostics 命名。

退出标准：

- 类型层表达新模型。
- 老字段无法被新代码引用。
- 编译错误指向需要迁移的实现点。

## Phase 2 DOM Projection Rewrite

目标：

- React adapter 改为 before trigger + rows + after trigger + bottom marker。
- row refs、trigger refs、commit ack 保持稳定。
- custom scrollbar overlay 切到 native mirror。

退出标准：

- DOM 中不存在 spacer。
- 短列表吸底由 CSS flow 完成。
- overlay 不再读取 virtual range。

## Phase 3 Transaction Rewrite

目标：

- 实现 projection transaction：消费 data runtime 的 extend-before / extend-after / reset-around / reset-latest / trim / identity-remap segment。
- 所有会改变 projection DOM 的 modifier 都走 visual anchor correction。
- edge latch 与 scroll source 重新接线。

退出标准：

- before / after native thumb rebound 场景通过。
- recovery scroll 不触发分页。
- segment trim 不跳 anchor。
- viewport runtime 没有合并、删除、去重 items 的代码路径。

## Phase 4 Destination And Lifecycle

目标：

- follow bottom partial segment 请求 latest reset。
- jump / restore 请求 around reset。
- short segment underflow fill 仲裁接入 pending intent。
- detach anchor checkpoint 与 generation guard 完整。

退出标准：

- feed switch restore 不依赖旧 scrollTop。
- StrictMode 不重复 observer。
- stale events 被丢弃。

## Phase 5 E2E Matrix

目标：

- 重建 testing 文档中的 P0-P4 场景。
- evidence API 删除 spacer 字段。
- 加入 native scrollbar oracle。

退出标准：

- testing 文档中的 P0-P4 场景真实浏览器通过。
- diagnostics 能解释所有 correction。
- 失败截图和 event log 足以定位责任层。
