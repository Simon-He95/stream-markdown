# Render scheduler & restore helper — usage

This file shows quick examples for using the render scheduler and the
`restoreWithVisibilityPriority` helper exported by the `stream-markdown`
package.

Importing
```ts
import {
  drain,
  getQueueLength,
  pause,
  restoreWithVisibilityPriority,
  resume,
  setTimeBudget,
} from 'stream-markdown'
```

Adjust time budget (ms)
```ts
// Tune how many ms per frame the shared scheduler will spend on jobs.
setTimeBudget(6)
```

Pause/resume (useful during large DOM updates or setup)
```ts
pause()
// ... enqueue many jobs or make synchronous DOM changes
resume()
```

Drain the queue immediately (synchronous — use sparingly)
```ts
// Runs all queued jobs synchronously, bypassing the per-frame budget.
drain()
```

Restore example (visible-first)
```ts
// items: { el: Element, render: () => void }[]
const cancel = restoreWithVisibilityPriority(items, {
  batchSize: 8,
  staggerMs: 40,
  // If true, visible jobs will be drained synchronously after scheduling.
  // This can block the main thread briefly — use with care.
  drainVisible: false,
})

// cancel() to abort remaining scheduled background batches
```

Notes
- `drain()` will block the main thread while running jobs — prefer smaller
  time budgets or staggered restores for better responsiveness.
- `getQueueLength()` is available to inspect pending jobs for monitoring.
