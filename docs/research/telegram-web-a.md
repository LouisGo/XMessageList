# Telegram Web A 调研取舍

## 参考文件

- [MessageList.tsx](https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/MessageList.tsx)
- [MessageListContent.tsx](https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/MessageListContent.tsx)
- [useScrollHooks.ts](https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/hooks/useScrollHooks.ts)
- [messageListReflow.ts](https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/helpers/messageListReflow.ts)
- [MessageList.scss](https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/MessageList.scss)
- [global/actions/api/messages.ts](https://github.com/Ajaxy/telegram-tt/blob/master/src/global/actions/api/messages.ts)

## 观察到的核心模式

Telegram Web A 的消息列表形态非常朴素：

```html
<div class="MessageList custom-scroll">
  <div class="messages-container">
    <div class="backwards-trigger"></div>
    <div class="message-date-group">...</div>
    <div class="forwards-trigger"></div>
    <div class="fab-trigger"></div>
  </div>
</div>
```

关键不是 class 名，而是：

- scroll container 是真实 native scroll。
- messages-container 是正常文档流。
- 上下只有 trigger，没有 top/bottom spacer。
- 数据层维护短 `viewportIds`。
- 数据变更前后用 anchor DOM rect 修正 scrollTop。

## 为什么滚动条会自然回落

Before paging 时：

1. 用户滚到顶部，before trigger intersect。
2. 数据层加载更旧消息并插到当前 segment 前面。
3. DOM 真实高度增加，浏览器 native `scrollHeight` 增加。
4. runtime 用旧 anchor top 与新 anchor top 的差值增加 `scrollTop`。
5. 因为 `scrollTop` 不再是 0，thumb 自然离开顶部。

这不是自定义滚动条算法。thumb 回落是 native scroll range 的直接结果。

## XMessageList 应吸收的点

- 以 loaded segment 作为 DOM truth。
- trigger 是分页入口，不是 scroll coordinate。
- reflow / measurement / correction 要批处理。
- 远距离目的地通过 around/latest reset，而不是全局滚动百分比。
- 短列表用布局吸底，不用 bottom spacer。

## XMessageList 不应照搬的点

- Telegram 把大量逻辑放在组件 hook 和 global action 中；XMessageList 需要独立 runtime。
- Telegram 业务消息、广告、未读、sticky date 与滚动逻辑相邻；XMessageList 必须保持 adapter / app / runtime 边界。
- Telegram 的具体 slice size 是产品策略；XMessageList 只定义 segment budget 原则。
- Telegram 的 custom-scroll 外观不是 XMessageList 的 core contract；我们的 contract 是 native metrics truth。

## 设计转译

| Telegram Web A | XMessageList 当前实现 |
| --- | --- |
| `viewportIds` | `LoadedSegment.items` |
| `backwards-trigger` | `data-edge-trigger="before"` |
| `forwards-trigger` | `data-edge-trigger="after"` |
| component layout effect reflow | runtime transaction after commit ack |
| `anchorIdRef + anchorTopRef` | `VisualAnchor` |
| action `loadViewportMessages` | runtime semantic event + data runtime request |
| `messages-container` flex-end | adapter DOM flow short-list layout |

## 性能启发

高性能不是少做 measurement，而是把 measurement 放在正确位置：

- scroll hot path 不全量测 rows。
- data commit 后只测当前 transaction 需要的 rows。
- ResizeObserver burst 合并到 rAF。
- edge observer 只发 signal，不拥有 mutation。
- diagnostics 采样或 ring buffer，避免 scroll event 级别日志。
