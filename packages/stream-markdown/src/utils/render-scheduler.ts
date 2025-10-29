// A simple cross-renderer scheduler that batches render jobs and enforces a
// per-frame time budget to avoid freezing the main thread when many renderers
// request updates at once (e.g., when restoring history).

const queue: Array<() => void> = []
let rafId: number | null = null
let paused = false

// Milliseconds per frame we allow for running jobs. Tuneable via setTimeBudget().
let TIME_BUDGET = 8 // ms

export function setTimeBudget(ms: number) {
  if (typeof ms === 'number' && ms >= 0)
    TIME_BUDGET = ms
}

export function getTimeBudget() {
  return TIME_BUDGET
}

export function isPaused() {
  return paused
}

export function getQueueLength() {
  return queue.length
}

export function pause() {
  paused = true
}

export function resume() {
  if (!paused)
    return
  paused = false
  ensureFrame()
}

function ensureFrame() {
  if (rafId != null)
    return
  if (paused)
    return
  rafId = requestAnimationFrame(runFrame)
}

function runFrame() {
  rafId = null
  const start = performance.now()
  while (queue.length > 0) {
    const job = queue.shift()!
    try {
      job()
    }
    catch (e) {
      // swallow errors per-job to keep the queue running
      // caller may log if needed

      console.error('render-scheduler job error', e)
    }
    if (performance.now() - start >= TIME_BUDGET) {
      // reached budget — schedule remainder for next frame
      break
    }
  }
  if (queue.length > 0)
    ensureFrame()
}

/**
 * Schedule a render job to be executed within the time-budgeted rAF loop.
 * Returns a function to cancel the scheduled job if it hasn't run yet.
 */
export function scheduleRenderJob(job: () => void, options?: { priority?: 'high' | 'normal' }) {
  const priority = options?.priority ?? 'normal'
  if (priority === 'high')
    queue.unshift(job)
  else
    queue.push(job)
  ensureFrame()
  let cancelled = false
  return () => {
    if (cancelled)
      return
    cancelled = true
    const idx = queue.indexOf(job)
    if (idx >= 0)
      queue.splice(idx, 1)
  }
}

/**
 * Run a job immediately, bypassing the scheduler. Use sparingly for very high
 * priority operations.
 */
export function runImmediate(job: () => void) {
  job()
}

/**
 * Drain the queue by running all pending jobs immediately, bypassing the
 * per-frame time budget. Use with caution — this can block the main thread.
 */
export function drain() {
  // If a frame is scheduled, cancel it — we'll run everything synchronously.
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  while (queue.length > 0) {
    const job = queue.shift()!
    try {
      job()
    }
    catch { /* swallow */ }
  }
}

/**
 * Clear all pending jobs and cancel the next frame. Used for cleanup.
 */
export function clearAll() {
  queue.length = 0
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}
