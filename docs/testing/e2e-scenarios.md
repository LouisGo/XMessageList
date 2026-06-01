# E2E 场景矩阵

本文档只记录当前 `e2e/runner/scenarioSpecs.ts` 中真实存在的场景：24 个
correctness 场景和 1 个 perf 场景。它是 runner catalog，不代表当前所有场景都已通过。

执行入口：

- `npm run e2e:p0`：只跑 priority `p0` correctness 场景。
- `npm run e2e:correctness`：跑全部 correctness 场景。
- `npm run e2e:perf`：跑独立 perf 场景。

## Correctness Lane

### P0 Smoke

| Scenario | 验收重点 |
| --- | --- |
| `bootstrap.latest-native-bottom` | latest bootstrap 后 runtime idle、无白屏、bottom lock 成立，evidence 合同完整。 |
| `paging.before-native-thumb-rebound` | before edge 真实触发一次 `needMoreBefore`；加载完成后 anchor 稳定、`scrollHeight` 增加、`scrollTop` 被 correction 推高。 |
| `paging.after-native-thumb-rebound` | after edge 真实触发一次 `needMoreAfter`；加载后 native range 增大且不误判 latest。 |
| `underflow.dual-edge-arbitration` | 短 segment 下同一 revision 不产生双边请求风暴。 |
| `identity.optimistic-server-remap` | optimistic row 获得 server id 后，`identity-remap` modifier、row key remap、viewport anchor 全部一致。 |

### P1 Live Tail And Dynamic Height

| Scenario | 验收重点 |
| --- | --- |
| `incoming.append-follow-motion` | latest bottom 下他人新消息通过 `incoming.append` 进入 `append` modifier，并保持 bottom lock。 |
| `send.composer-event-storm-follow-bottom` | event storm 中普通 Composer send 通过 outgoing 语义回到 latest，并保持 bottom lock。 |
| `send.optimistic-event-storm-follow-bottom` | event storm 中 optimistic send 不靠历史对齐掩盖行为，发送后保持 bottom lock。 |
| `dynamic-height.above-anchor-growth` | anchor 上方 row 高度变化后，当前 visual anchor 屏幕位置稳定。 |
| `dynamic-height.streaming-current-row` | 当前 row streaming 增高时保持阅读位置，不退化成 reset。 |

### P2 Destination And Budget

| Scenario | 验收重点 |
| --- | --- |
| `destination.jump-in-segment` | 目标在当前 loaded segment 内时只做 local align，不请求 around，目标接近 center。 |
| `destination.jump-outside-segment` | 目标不在当前 loaded segment 内时发一次 `needMessagesAround`，reset 后目标可见并接近 center。 |
| `follow-bottom.partial-segment` | partial segment 下 follow bottom 发 latest need；latest reset 后进入 bottom lock。 |
| `segment-budget.trim-after-appends` | 大量 append 后 item count 不超过预算，期望 `trim-before`，并保持 latest bottom lock。 |

### P3 Lifecycle

| Scenario | 验收重点 |
| --- | --- |
| `feed-switch.detach-anchor-checkpoint` | feed detach 前保存 identity anchor checkpoint；切回后通过 around restore，不复用 raw scrollTop。 |
| `strictmode.attach-detach-attach` | 连续 remount 后 runtime idle、diagnostics 有界、refs/observers 不重复积累。 |

### P4 Scrollbar And Loading Overlay

| Scenario | 验收重点 |
| --- | --- |
| `scrollbar.overlay-native-mirror` | custom overlay thumb 位置和高度只由 native metrics 推导。 |
| `scrollbar.drag-edge-before` | 拖拽 overlay 到顶部触发一次 before need，overlay 继续镜像 native metrics。 |
| `scrollbar.drag-edge-after` | 拖拽 overlay 到底部触发一次 after need，overlay 继续镜像 native metrics。 |
| `scrollbar.held-drag-no-repeat-before` | held drag 触顶时，同一 before loading 期间不重复发请求。 |
| `scrollbar.held-drag-rebound-continuity` | before load 完成后 thumb 随真实 range 回落；同一次 held drag 保持连续。 |
| `scrollbar.track-click-no-global-jump` | track click 只在当前 loaded segment 内 page jump，不使用全局历史百分比。 |
| `loading-overlay.cold-session-delay` | 慢 cold session 切换先不显示 overlay，超过阈值后显示，且 overlay 不进入 scroll container。 |
| `loading-overlay.fast-session-no-overlay` | 快速 session 切换不显示居中 loading overlay。 |

## Perf Lane

| Scenario | 验收重点 |
| --- | --- |
| `perf.scroll-observation-budget` | event storm、bot push 和滚动组合后 runtime idle，diagnostics 数量保持有界。 |

## 维护规则

- 新增/删除 runner 场景时，同步更新本文档；不要记录尚未实现的未来场景。
- 场景验收口径以 [oracles.md](./oracles.md) 为准。
- 失败报告必须依赖 bridge evidence、event log、diagnostics 和截图，不能读取 runtime private object 补答案。
