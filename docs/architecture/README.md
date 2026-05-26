# 架构文档

本目录只回答“系统应该是什么”。具体 DOM 施工看 [implementation](../implementation/README.md)，用户可观察行为看 [interaction-specs](../interaction-specs/README.md)。

## 文件职责

| 文档 | 负责回答 | 不负责 |
| --- | --- | --- |
| [principles.md](./principles.md) | 为什么选择 loaded segment native scroll | 具体 API 命名 |
| [layering-and-ownership.md](./layering-and-ownership.md) | main、data runtime、viewport runtime、React、host 的边界 | 单个事务时序 |
| [anchor-and-data-window.md](./anchor-and-data-window.md) | identity anchor、visual anchor、loaded segment、数据窗口关系 | DOM class 细节 |
| [runtime-state-machine.md](./runtime-state-machine.md) | runtime 的生命周期、transaction、pending intent、edge latch 状态轴 | E2E 场景列表 |

## 新基座一句话

```text
Data runtime gives a short contiguous loaded segment
  -> React renders real flow rows plus two edge triggers
  -> viewport runtime measures committed DOM and preserves visual anchors
  -> native scroll range equals the currently loaded segment height
```

## 架构硬约束

- scrollHeight 不能包含未加载消息的估算高度。
- 当前 DOM 只表达 loaded segment，不表达全历史坐标系。
- runtime 是 scrollTop 写入、measurement、anchor correction 和 edge latch 的唯一 owner。
- React 只投影 DOM、注册 refs、提交 commit ack、渲染 slots。
- host/data 层只响应 semantic events，不读取 projection DOM 来推断分页。
- loaded segment 边界、modifier、identity remap、generation/revision/token 必须作为合同字段跨层传递。
- 自定义滚动条 overlay 只镜像 native metrics，不拥有滚动模型。
