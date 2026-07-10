# 区分 Loaded Context 与 Bottom Lock

XMessageList 区分 loaded rows 的语义上下文和 viewport 的 bottom lock 状态：`latest` 表示 loaded segment 代表最新消息区间，bottom lock 表示 viewport 当前贴在底部。我们选择三态 loaded context（`latest`、`history`、`around`），而不是 boolean latest flag，避免 host restore、destination jump、remote append 和 scroll-to-latest 行为被压成同一种状态。`reachedLatest` 可以把 `history` 提升为 `latest`，viewport 触发的提升可以使用既有 bottom-lock 机制，`around` 不自动提升，remote tail append 只在 latest context 下有效，local tail stage 可以在宿主提供 latest page 时进入 latest。

会话首次进入的 `Initial Window` 与显式 `Latest Window` 是两个不同请求语义。宿主若能原子返回持久化阅读位置，应实现 `adapter.request.loadInitial`，返回 `{ context:'latest', page }` 或 `{ context:'history', page, restore }`。history initial page 可以同时 `hasMoreBefore=true`、`hasMoreAfter=true`；latest initial page 仍必须满足 `hasMoreAfter=false`。提供 `loadInitial` 后，它优先于 `anchorMemory.load`，避免“先读旧 memory、再发 around”的第二套恢复链路。显式 `loadLatest`、`reloadLatest` 和 scroll-to-latest 始终只接受严格 latest page。
