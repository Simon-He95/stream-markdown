# 渲染调度器与恢复助手 — 使用说明

当你需要一次性恢复大量 code block 或批量调度渲染更新时，直接让每个渲染器并发执行会占满主线程，造成页面卡顿。库内提供一个小型调度器和恢复助手，用于平滑分帧执行渲染任务。

主要 API：

- `setTimeBudget(ms)` / `getTimeBudget()` — 设置 / 获取共享调度器每帧用于执行任务的时间预算（默认 8ms）。
- `pause()` / `resume()` — 暂停/恢复调度器（任务保留在队列中）。
- `drain()` — 立即同步执行所有待处理任务（会绕过每帧预算，可能阻塞主线程，慎用）。
- `getQueueLength()` — 获取当前排队任务数，便于监控。
- `restoreWithVisibilityPriority(items, opts)` — 恢复辅助函数：优先调度可见元素（高优先级），对不可见项按小批量分批入队以降低峰值压力。可选项包括 `batchSize`、`staggerMs` 和 `drainVisible`（若为 true，会在调度可见项后立即 `drain()`，强制完成可见渲染，可能短暂阻塞）。

示例：

```ts
import { restoreWithVisibilityPriority, setTimeBudget } from 'stream-markdown'

// 将每帧预算调小，以降低单帧主线程占用
setTimeBudget(6)

const items = blocks.map(b => ({ el: b.container, render: () => renderer.updateCode(b.code) }))
restoreWithVisibilityPriority(items, { batchSize: 8, staggerMs: 40 })
```

注意事项：

- `drain()` 会在主线程同步执行所有队列任务，可能导致短时间大幅卡顿。优先使用 `setTimeBudget` / 分批策略。
- `getQueueLength()` 对调试恢复行为很有帮助，可结合 demo 中的实时指标观察队列变化。
