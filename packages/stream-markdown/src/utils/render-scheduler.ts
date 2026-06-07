// A simple cross-renderer scheduler that batches render jobs and enforces a
// per-frame time budget to avoid freezing the main thread when many renderers
// request updates at once (e.g., when restoring history).

const queue: Array<() => void> = []
type FrameHandle = number | ReturnType<typeof setTimeout>

let rafId: FrameHandle | null = null
let cancelScheduledFrame: ((id: FrameHandle) => void) | null = null
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

function now() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now()
}

function getFrameScheduler(): {
  request: (cb: FrameRequestCallback) => FrameHandle
  cancel: (id: FrameHandle) => void
} {
  const globalScope = globalThis as any
  const win = typeof window !== 'undefined' ? (window as any) : null
  const candidates = [globalScope, win].filter(Boolean)

  for (const owner of candidates) {
    if (
      typeof owner.requestAnimationFrame === 'function'
      && typeof owner.cancelAnimationFrame === 'function'
    ) {
      return {
        request: cb => owner.requestAnimationFrame(cb),
        cancel: id => owner.cancelAnimationFrame(id as number),
      }
    }
  }

  return {
    request: cb => setTimeout(() => cb(now()), 16),
    cancel: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  }
}

function cancelFrame() {
  if (rafId == null)
    return

  const id = rafId
  const cancel = cancelScheduledFrame
  rafId = null
  cancelScheduledFrame = null
  try {
    cancel?.(id)
  }
  catch {}
}

function ensureFrame() {
  if (rafId != null)
    return
  if (paused)
    return
  if (queue.length === 0)
    return
  const scheduler = getFrameScheduler()
  let ranSynchronously = false
  const run: FrameRequestCallback = () => {
    ranSynchronously = true
    runFrame()
  }

  try {
    cancelScheduledFrame = scheduler.cancel
    const id = scheduler.request(run)
    if (ranSynchronously)
      return
    rafId = id
  }
  catch {
    if (ranSynchronously)
      return
    rafId = setTimeout(run, 16)
    cancelScheduledFrame = id => clearTimeout(id)
  }
}

function runFrame() {
  rafId = null
  cancelScheduledFrame = null
  const start = now()
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
    if (now() - start >= TIME_BUDGET) {
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
  let cancelled = false
  const wrappedJob = () => {
    if (!cancelled)
      job()
  }

  if (priority === 'high')
    queue.unshift(wrappedJob)
  else
    queue.push(wrappedJob)

  ensureFrame()
  return () => {
    if (cancelled)
      return
    cancelled = true
    const idx = queue.indexOf(wrappedJob)
    if (idx >= 0) {
      queue.splice(idx, 1)
      if (queue.length === 0)
        cancelFrame()
    }
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
  cancelFrame()
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
  cancelFrame()
}
