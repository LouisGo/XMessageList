# 实现施工图

本目录回答“怎么落地”。交互正确性以前置 [interaction-specs](../interaction-specs/README.md) 为准，架构边界以前置 [architecture](../architecture/README.md) 为准，术语和 API 命名以前置 [naming-and-api.md](../architecture/naming-and-api.md) 为准。

## 文件职责

| 文档 | 内容 |
| --- | --- |
| [dom-layout.md](./dom-layout.md) | DOM skeleton、CSS 布局、ref registry |
| [transactions-and-measurement.md](./transactions-and-measurement.md) | segment transaction、commit ack、anchor correction |
| [react-adapter.md](./react-adapter.md) | React adapter 外部 store、slots、禁止事项 |
| [performance-and-observability.md](./performance-and-observability.md) | 性能预算、observer、diagnostics、profiling |

## 实现总路线

1. 先建立 loaded segment projection snapshot，不从旧 RenderWindow / spacer 结构迁移。
2. 再建立 DOM skeleton：before trigger + rows + after trigger + bottom marker。
3. 然后实现 transaction：viewport 消费 data runtime 的 extend / reset / trim / identity-remap snapshot，并完成 anchor correction。
4. 最后收敛 scrollbar：overlay 只镜像 native metrics。
