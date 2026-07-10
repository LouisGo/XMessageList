# Oracles

Oracles 只使用 E2E bridge 暴露的稳定 evidence。它们不读取 runtime private
object，也不把截图当成唯一判断依据。

## Evidence Shape

Runtime evidence 来自 `ViewportEvidence`：

```ts
type ViewportEvidence = {
  sessionId: string;
  generation: number;
  segmentRevision: number;
  projectionRevision: number;
  commitToken: ProjectionCommitToken | null;
  modifier: SegmentModifier['type'];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  bottomLockState: 'LOCKED' | 'UNLOCKED';
  pendingIntent:
    | 'edge-before'
    | 'edge-after'
    | 'underflow-fill'
    | 'follow-bottom'
    | 'destination'
    | null;
  shortSegmentAlignment: 'start' | 'center' | 'end';
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  visibleRows: Array<{
    key: string;
    stableId?: string;
    serverId?: string;
    rowKind: string;
    top: number;
    bottom: number;
  }>;
  beforeTrigger: DOMRectLike;
  afterTrigger: DOMRectLike;
  bottomMarker: DOMRectLike | null;
  phase: 'IDLE' | 'PROJECTING' | 'MEASURING' | 'CORRECTING' | 'MOTION';
  edgeState: {
    before: { status: string; latchToken?: string; requestToken?: string };
    after: { status: string; latchToken?: string; requestToken?: string };
  };
};
```

Browser E2E evidence extends it:

```ts
type E2EEvidence = ViewportEvidence & {
  schemaVersion: 2;
  scenarioId: string;
  checkpointId: string;
  timestamp: number;
  scrollContainerTop: number;
  segment: {
    itemCount: number;
    firstKey: string | null;
    lastKey: string | null;
    firstIdentity: E2EIdentityEvidence | null;
    lastIdentity: E2EIdentityEvidence | null;
    modifier: SegmentModifier;
  };
  events: E2ERuntimeEventRecord[];
  diagnostics: ViewportDiagnosticRecord[];
  overlay: {
    visible: boolean;
    thumbTop: number;
    thumbHeight: number;
    expectedThumbTop: number;
    expectedThumbHeight: number;
    trackHeight: number;
  } | null;
  sessionOverlay: {
    visible: boolean;
    inScrollContainer: boolean;
  };
};
```

Evidence 必须包含 segment boundary、modifier、generation/revision/token、
identity、event log 和 diagnostics。当前基座没有旧式远端高度字段；任何
oracle 都不能通过这些字段补答案。

## Base Oracles

每个 correctness/perf 场景默认检查：

- runtime phase 为 `IDLE`，且没有 pending operation 卡住。
- viewport 有可见 rows 或明确 empty state，不白屏。
- evidence schema version、segment boundary 和 commit token 完整。
- 没有 unexpected `viewportError`。

## Behavior Oracles

| Oracle | 通过条件 |
| --- | --- |
| Anchor preservation | transaction 前后同一逻辑 row 可解析；anchor top delta 在阈值内；correction diagnostic 可解释。 |
| Edge need | user/momentum/direct-scroll source 进入 trigger 后按 edge 和 revision 去重；request token 与 event/evidence 一致。 |
| Underflow | 短 segment 一轮最多一个 edge request；两侧 exhausted 后不循环重试。 |
| Bottom follow | `hasMoreAfter=true` 时 follow bottom 发 latest need；latest reset 后 `hasMoreAfter=false` 才 locked。 |
| Destination | segment 内目标只 local align；segment 外目标发 around need；完成后目标或 fallback 可见并按可达位置对齐。 |
| Session switch | detach 前发布 identity anchor checkpoint；切回后通过 around/latest restore，不保存 raw scrollTop。 |
| Dynamic height | height change 由 DOM/ResizeObserver 触发；above-anchor growth 后 visual anchor 稳定；不通过 reset 掩盖。 |
| Segment trim | item count 低于预算；trim modifier 方向符合场景预期；visual anchor 或 bottom lock 保持稳定。 |
| Identity remap | modifier 显式携带 `from` / `to` 与 `previousKey -> nextKey`；remap 后 anchor 和 persisted identity 更新。 |
| Remove transaction | removed key 不触发 full-measure fallback；只失效 `firstAffectedIndex` 起的 metric；survivor renderVersion 不变；被删锚点 successor-first。 |
| Structural reload | pending/failed/stale 保留旧 rows；用户新导航使旧结果 stale；`applied` 晚于 DOM settle；一次 transaction 最多一次 scrollTop correction。 |
| Custom overlay | thumb top/height 与 native metrics 误差在阈值内；overlay 不访问 paging、bottom lock、trim 或 anchor state。 |
| Held drag continuity | edge loading 期间同方向不重复请求；load settle 后 thumb 随真实 range 回落，同一次 drag 不被取消或锁死。 |
| Loading overlay | cold session overlay 不在 scroll container 内；慢请求超过阈值才显示，快请求不显示。 |
| Performance | scroll/event storm 后 diagnostics 数量有界，runtime 回到 idle。 |

## Failure Reports

失败报告至少包含：

- scenario id、action id、oracle id、owner 和 error code。
- final evidence、关键 checkpoint evidence、runtime events 和 diagnostics。
- 必要截图路径。

报告只能定位 owner 和证据，不应把一次失败改写成“设计结论”。当前 docs 记录场景
和 oracle 合同，具体通过率以当次 `.logs/e2e/**/summary.json` 为准。
