# DOM 与布局

## 固定 DOM skeleton

```html
<div data-message-list>
  <div data-message-scroll-container>
    <div data-message-flow>
      <div data-edge-trigger="before"></div>
      <div data-message-row="..."></div>
      <div data-message-row="..."></div>
      <div data-edge-trigger="after"></div>
      <div data-bottom-marker></div>
    </div>
  </div>
  <div data-message-list-affordance-layer><!-- scroll-to-latest --></div>
  <div data-message-list-overlay-layer><!-- loading/error overlay --></div>
</div>
```

约束：

- `data-message-list` 是 `MessageList` component 的 root。
- `data-message-scroll-container` 是唯一 scroll container。
- rows、triggers、bottom marker 都在正常文档流中。
- scroll-to-latest 与 overlay 都在 scroll container 外的 root overlay layer；它们不能
  增加 `scrollHeight` 或改变 bottom marker 的几何含义。
- 不用额外占位高度伪造未加载历史。
- `data-message-flow` 在短内容时按 snapshot 的 short alignment 负责真实布局。
- `overflow-anchor` 由 runtime 统一关闭或控制，避免浏览器 scroll anchoring 与 runtime correction 竞争。

## 结构布局原则

`MessageList` 直接提供唯一 scroll owner、`overflow-anchor:none`、flow flex、短窗口
对齐、edge/bottom marker 最小尺寸以及 overlay positioning。Host CSS 只负责高度、
padding、颜色和 slot 视觉样式，不能复制或覆盖这些滚动正确性不变量。

说明：

- `data-short-align="end"` 只用于 latest bootstrap、locked bottom 或明确 follow bottom。
- around restore / jump 的短 segment 可以使用 `center` 或 `start`，不能被默认吸底语义覆盖。
- 一旦 rows 高度超过 viewport，浏览器按真实 DOM 高度滚动。
- trigger 可以是 1px 或视觉隐藏元素，但必须存在于文档流。
- root 所在 flex/grid 子树仍必须给 `MessageList` 一个确定高度；组件内已经固定
  `min-width:0/min-height:0`，避免产生第二个 overflow owner。

## Ref Registry

Runtime registry 至少保存：

- scroll container
- message flow root
- before trigger
- after trigger
- bottom marker
- row key -> HTMLElement

Registry 规则：

- row key 使用 runtime item key，不使用 array index。
- 普通消息 row 至少暴露 `data-runtime-key`、`data-row-kind`，有业务消息身份时再暴露 `data-message-stable-id` / `data-message-server-id`。
- ref callback 必须可重入，支持 StrictMode attach/detach。
- detach 时先 capture anchor，再清 refs。

## Projection Snapshot

DOM projection snapshot 应该接近：

```ts
type ProjectionCommitToken = {
  sessionId: string;
  generation: number;
  segmentRevision: number;
  projectionRevision: number;
};

type EdgeSnapshotState = {
  status: 'idle' | 'loading' | 'error' | 'exhausted';
  latchToken?: string;
  requestToken?: string;
};

type MessageListSnapshot = {
  sessionId: string;
  generation: number;
  segmentRevision: number;
  projectionRevision: number;
  commitToken: ProjectionCommitToken;
  items: MessageDataItem[];
  segmentMeta: {
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    modifier: SegmentModifier;
    anchor?: MessageIdentityAnchor;
    anchorStatus?: 'normal' | 'deleted' | 'unavailable' | 'permission';
    shortSegmentAlignment: 'start' | 'center' | 'end';
    underflow: 'unknown' | 'fillable' | 'settled';
  };
  edgeState: {
    before: EdgeSnapshotState;
    after: EdgeSnapshotState;
  };
  bottomLockState: 'LOCKED' | 'UNLOCKED';
  pendingIntent?: 'edge-before' | 'edge-after' | 'underflow-fill' | 'follow-bottom' | 'destination';
  viewportPhase: 'IDLE' | 'PROJECTING' | 'MEASURING' | 'CORRECTING' | 'MOTION';
};
```

Snapshot 不包含：

- 未加载历史的估算高度
- 全局滚动坐标
- raw scrollTop

Snapshot 规则：

- `MessageListSnapshot` 是 runtime 到 React adapter 的内部 projection
  snapshot；它不从 package root 作为业务 public API 暴露。
- `hasMoreBefore/After`、`modifier`、`generation`、`segmentRevision`、`projectionRevision` 和 `commitToken` 是 projection / adapter / E2E 的必需合同字段。
- React slots 和 tests 只能从 snapshot/evidence 读取 segment 边界，不得从 edgeState 或外部 props 反推 `hasMoreAfter`。
- 同一 segment revision 可以因为 edge state、bottom lock 或 viewport phase 变化产生新的 projection revision；commit ack 必须回传完整 token。

## Edge Loading UI

Before / after loading indicator 可以渲染在 trigger 旁边，但必须是真实 DOM：

- loading 高度进入 native scrollHeight。
- error / retry 高度进入 native scrollHeight。
- exhausted 状态可以隐藏 trigger 或保留零高 marker。

任何 edge UI 的高度变化都要走 normal measurement stabilization。
