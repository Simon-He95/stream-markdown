// A simple cross-renderer scheduler that batches render jobs and enforces a
// per-frame time budget to avoid freezing the main thread when many renderers
// request updates at once (e.g., when restoring history).

type RenderJob = () => void
const highQueue: RenderJob[] = []
const normalQueue: RenderJob[] = []
type FrameHandle = number | ReturnType<typeof setTimeout>

let rafId: FrameHandle | null = null
let frameToken = 0
let cancelScheduledFrame: ((id: FrameHandle) => void) | null = null
let paused = false

// Milliseconds per frame we allow for running jobs. Tuneable via setTimeBudget().
let TIME_BUDGET = 8 // ms

export function setTimeBudget(ms: number) {
  if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0)
    TIME_BUDGET = ms
}

export function getTimeBudget() {
  return TIME_BUDGET
}

export function isPaused() {
  return paused
}

export function getQueueLength() {
  return highQueue.length + normalQueue.length
}

export function pause() {
  paused = true
  cancelFrame()
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

function hasQueuedJobs() {
  return highQueue.length > 0 || normalQueue.length > 0
}

function shiftQueuedJob(): RenderJob | undefined {
  return highQueue.shift() ?? normalQueue.shift()
}

function removeQueuedJob(job: RenderJob): boolean {
  let idx = highQueue.indexOf(job)
  if (idx >= 0) {
    highQueue.splice(idx, 1)
    return true
  }

  idx = normalQueue.indexOf(job)
  if (idx >= 0) {
    normalQueue.splice(idx, 1)
    return true
  }

  return false
}

function clearQueues() {
  highQueue.length = 0
  normalQueue.length = 0
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
  frameToken++
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
  if (!hasQueuedJobs())
    return
  const scheduler = getFrameScheduler()
  const token = ++frameToken
  let ranSynchronously = false
  const run: FrameRequestCallback = () => {
    if (token !== frameToken)
      return

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

    const fallbackToken = ++frameToken
    const fallbackRun: FrameRequestCallback = () => {
      if (fallbackToken !== frameToken)
        return

      ranSynchronously = true
      runFrame()
    }

    rafId = setTimeout(fallbackRun, 16)
    cancelScheduledFrame = id => clearTimeout(id as ReturnType<typeof setTimeout>)
  }
}

function runFrame() {
  rafId = null
  cancelScheduledFrame = null

  if (paused)
    return

  const start = now()
  while (hasQueuedJobs()) {
    const job = shiftQueuedJob()!
    try {
      job()
    }
    catch (e) {
      // swallow errors per-job to keep the queue running
      // caller may log if needed

      console.error('render-scheduler job error', e)
    }

    if (paused)
      break

    if (now() - start >= TIME_BUDGET) {
      // reached budget — schedule remainder for next frame
      break
    }
  }
  if (!paused && hasQueuedJobs())
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
    highQueue.push(wrappedJob)
  else
    normalQueue.push(wrappedJob)

  ensureFrame()
  return () => {
    if (cancelled)
      return
    cancelled = true
    if (removeQueuedJob(wrappedJob)) {
      if (!hasQueuedJobs())
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
  while (hasQueuedJobs()) {
    const job = shiftQueuedJob()!
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
  clearQueues()
  cancelFrame()
}
