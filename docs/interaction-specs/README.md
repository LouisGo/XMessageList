# 交互规格

本目录只描述用户和外部接入方能观察到的行为。实现细节归 [implementation](../implementation/README.md)，测试证据归 [testing](../testing/README.md)。

## 文件职责

| 文档 | 覆盖行为 |
| --- | --- |
| [scrolling.md](./scrolling.md) | 普通滚动、惯性、短列表吸底、动态高度 |
| [paging.md](./paging.md) | before / after trigger、批量加载、请求去重、错误恢复 |
| [scrollbar.md](./scrollbar.md) | native scrollbar 和 optional overlay 的 thumb 行为 |
| [bottom-follow-and-destination.md](./bottom-follow-and-destination.md) | follow bottom、jump、restore、latest / around reset |

## 规格格式

每条规格包含：

- Trigger：用户动作或系统事件。
- Preconditions：必须成立的状态。
- Runtime behavior：runtime 必须做什么。
- User-visible result：用户看到什么。
- Forbidden：明确禁止的解释或实现。
