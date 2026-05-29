# 交互规格

本目录只描述用户和外部接入方能观察到的行为。实现细节归 [implementation](../implementation/README.md)，测试证据归 [testing](../testing/README.md)。

## 文件职责

| 文档 | 覆盖行为 |
| --- | --- |
| [activation-and-restore.md](./activation-and-restore.md) | 会话首次进入、阅读位置恢复、会话切换、激活 loading |
| [destination-jumps.md](./destination-jumps.md) | pin、mentions、收藏、搜索、引用等目标消息定位跳转 |
| [live-events.md](./live-events.md) | 消息推送、编辑、reaction、删除、批量事件、event storm |
| [scrolling.md](./scrolling.md) | 普通滚动、惯性、短列表吸底、动态高度 |
| [paging.md](./paging.md) | before / after trigger、批量加载、请求去重、错误恢复 |
| [scrollbar.md](./scrollbar.md) | native scrollbar 和 optional overlay 的 thumb 行为 |
| [bottom-follow-and-destination.md](./bottom-follow-and-destination.md) | follow bottom、latest / around reset、restore 桥接 |

## 规格格式

每条规格使用以下字段描述；没有独立前置条件的场景可以省略 Preconditions：

- Trigger：用户动作或系统事件。
- Preconditions：必须成立的状态。
- Acceptance：必须满足的交互验收结果。
- User-visible result：用户能观察到什么。
- Forbidden：明确禁止的解释或实现。
