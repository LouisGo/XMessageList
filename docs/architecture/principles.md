# 架构原则

## 目标体验

用户向上或向下滚动到已加载区域边缘时：

- 触发异步批量加载。
- 新消息进入当前正常文档流。
- 旧视觉 anchor 保持在原来的屏幕位置。
- 原生滚动条因为真实 `scrollHeight` 改变而自然离开边缘。
- 触控板、鼠标滚轮、触摸惯性不被 runtime 人为打断。

这就是当前底层基座。它不是“虚拟列表更像 Telegram”，而是放弃用估算高度伪装全历史，改用真实 loaded segment 作为浏览器滚动事实。

## 为什么不是 top/bottom spacer

top / bottom spacer 会把未加载或未挂载消息的估算高度注入 `scrollHeight`。这会带来三个根本问题：

- 滚动条位置表达的是估算全局高度，不是已加载区域的真实高度。
- 触边分页后，thumb 是否回落取决于估算修正，不取决于真实 DOM 插入。
- 惯性滚动期间 runtime 很容易在 spacer、window slide、anchor correction 之间争夺 `scrollTop`。

当前实现不把 spacer 当作滚动连续性的基础。连续性来自短窗口加载、真实 DOM 高度和视觉 anchor correction。

## 借鉴 Telegram Web A，但不照搬

可借鉴：

- 唯一 scroll container。
- 正常文档流消息。
- before / after 两个边界 trigger。
- 数据变更前后保存 message DOM anchor 的 rect top。
- 数据窗口保持短 segment，不把全历史投影到 DOM。

不照搬：

- 不把滚动逻辑写在 React hook 链里。
- 不让业务全局 store 直接承担 viewport transaction。
- 不把具体聊天业务、未读、广告、reply 等 UI 状态混进 runtime core。
- 不依赖 framework 特有的 fast list 行为作为正确性基础。

XMessageList 的取舍是：Telegram-style DOM 形态，加上独立 runtime 的 transaction、measurement、edge latch 和 diagnostics。

## 外部经验准入

当前实现不做多家 virtualizer / recycler 的最佳实践拼装。任何外部经验进入 core 前，必须同时满足：

- 不引入第二套 scroll truth，`scrollHeight` 仍只来自当前 loaded segment 的真实 DOM。
- 能翻译成 `SegmentModifier`、identity/runtime key、projection transaction、commit ack 或 evidence oracle。
- 不改变所有权：loaded segment store 发布 immutable segment，viewport runtime 负责 measurement / correction，React adapter 只投影和 ack。

可以进入 core：

- Telegram-style loaded segment + native scroll truth。
- 数据变化显式 modifier。
- headless runtime / React projection 边界。
- visual anchor / bottom marker 作为 visible-content-position 合同。

只能作为辅助机制：

- row height cache、measurement snapshot restore、pending jump compensation、blank area / frame gap telemetry。
- 它们只能服务于当前 loaded segment 的测量、诊断和恢复，不能生成全历史坐标。

明确拒绝：

- global estimated range、top/bottom spacer、React-side correction、observer-owned mutation。
- recycler pool 进入 core。除非 profile 证明 DOM allocation 是主要瓶颈，并且 row state discipline 已单独设计。
- 自动估算或 median estimate 成为 runtime 的滚动事实来源。

## 核心术语

| 术语 | 定义 |
| --- | --- |
| Loaded Segment | loaded segment store 当前发布给 viewport 的一段连续消息，React 会把它完整投影到 DOM。 |
| Native Scroll Range | 浏览器从当前 DOM 计算出的 `scrollHeight - clientHeight`。 |
| Edge Trigger | Segment 上下两端的正常文档流元素，只负责分页观察。 |
| Identity Anchor | 跨进程、跨数据层可持久化的消息身份。 |
| Visual Anchor | runtime 内部使用的 DOM row + offset，用来保持屏幕位置。 |
| Segment Extend | before 或 after 分页后，loaded segment store 发布合并后的 next segment。 |
| Segment Reset | jump / restore / latest 等目的地请求返回一段新 segment。 |
| Segment Trim | 当前 segment 超过预算后，loaded segment store 发布裁剪后的 next segment，viewport 保持 visual anchor。 |

## 正确性优先级

1. 用户看到的阅读位置稳定。
2. scrollHeight 真实反映当前 loaded segment。
3. 边界请求可去重、可取消、可诊断。
4. 滚动条行为来自 native scroll metrics。
5. 性能优化不能引入第二套坐标系统。
