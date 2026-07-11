# 结构重载与删除事务

XMessageList 把局部删除与结构重载建模为两种不同的 viewport transaction。

局部删除由 `session.rows.mutate({ removeKeys })` 进入 loaded segment。数据层必须从
删除前 segment 产出实际 removed keys、旧 index 和每个 removed key 的存活邻居；
runtime 只失效首个受影响 index 开始的 metric。removed key 不再进入新 snapshot 的
通用 dirty-key 查找，因此不能触发 missing-key full measurement。被删视觉锚点优先
落到 successor，无 successor 才使用 predecessor。

Host 无法通过局部 mutation 证明当前窗口仍连续时，使用
`session.commands.reloadCurrent({ reason: 'structural' })`。真实 latest 且 locked 时
请求 latest；其他状态按第一条可见消息和 `offsetWithinMessage` 请求 around。请求
期间保留旧 rows，只有 page projection、measurement 和单次 correction 全部 settle
后才返回 `applied`。用户新导航、更新的 reload、topology change 或 session destroy
使旧结果 stale。

如果 Host 已知最后一个可信 boundary，则优先使用
`session.rows.invalidateAfter({ boundaryKey, reason })`：保留 boundary，裁剪其后的不可信
suffix，将 latest context 降为 history，设置 `hasMoreAfter=true`，并通过 topology revision
使失效前的 after token stale。即使 boundary 已是末项也必须推进 revision，不能把
“没有 rows 可删”误判成无需屏障。该操作使用 trim-after maintenance transaction 维持
视觉锚点并恢复 after latch；可见范围跨过 boundary 时同步拒绝。viewport phase 非
`IDLE`、事务/motion/scroll frame 未结算或 direct-scroll 仍持有视口时返回
`runtime-busy`，Host 必须改用 `reloadCurrent({ reason: 'structural' })` 或等待 runtime
settle 后重试。

真实 latest tail 对账使用
`session.commands.reloadLatest({ reason: 'tail-reconcile' })`。其 Promise 与本次命令一一
对应，且只在该 latest projection 完成 DOM settle 后返回 `applied`；无参 overload 仍为
兼容旧调用方的 fire-and-forget 命令。

Host 继续拥有 canonical message cache 和 structural dirty revision。XMessageList
不保存业务 dirty journal；Host 只能在 `applied` 且 revision 未变化时条件清理。
目标已删除时 successor/predecessor 顺序由 page 的 fallback anchor 明确表达，runtime
不从 message id 或业务 position 猜顺序。
