import { drain, pause, resume, scheduleRenderJob } from './render-scheduler.js'

export interface RestoreItem {
  // element representing the code block (used for visibility check)
  el: Element
  // actual work to run (should be cheap wrapper that calls renderer.updateCode)
  render: () => void
}

export interface RestoreOptions {
  // how many background items to schedule per stagger step
  batchSize?: number
  // stagger interval between background batches (ms)
  staggerMs?: number
  // whether to immediately drain visible jobs after scheduling (may block)
  drainVisible?: boolean
}

/**
 * Restore a set of render items prioritizing visible elements.
 *
 * Behavior:
 * - immediately schedules visible items with high priority
 * - staggers non-visible items in batches to avoid flooding the scheduler
 *
 * Returns a cancel function to abort scheduling of remaining background jobs.
 */
export function restoreWithVisibilityPriority(items: RestoreItem[], opts: RestoreOptions = {}) {
  const batchSize = Math.max(1, opts.batchSize ?? 6)
  const staggerMs = Math.max(1, opts.staggerMs ?? 30)

  // Quick visible check using bounding rect (best-effort). This is used only
  // during restore actions which are expected to be rare. We avoid doing any
  // expensive layout in the scheduler itself.
  const visible: RestoreItem[] = []
  const hidden: RestoreItem[] = []

  for (const it of items) {
    const rect = (it.el as Element).getBoundingClientRect()
    const ih = (globalThis as any).innerHeight ?? 0
    const isVis = rect.bottom >= 0 && rect.top <= ih
    if (isVis)
      visible.push(it)
    else hidden.push(it)
  }

  // Pause scheduler while we enqueue to avoid partial execution during setup.
  // We'll resume afterwards so the visible/high-priority jobs run first.
  pause()
  for (const v of visible) {
    scheduleRenderJob(() => {
      try {
        v.render()
      }
      catch { /* swallow */ }
    }, { priority: 'high' })
  }
  resume()
  // Optionally drain visible jobs now to force them to complete. This will
  // run queued jobs synchronously and can block the main thread briefly; use
  // with caution.
  if (opts.drainVisible)
    drain()

  // Stagger hidden items in small batches to avoid queueing too many jobs at once
  let cancelled = false
  const timers: number[] = []

  for (let i = 0; i < hidden.length; i += batchSize) {
    const batch = hidden.slice(i, i + batchSize)
    const delay = Math.floor(i / batchSize) * staggerMs
    const t = setTimeout(() => {
      if (cancelled)
        return
      for (const b of batch) {
        scheduleRenderJob(() => {
          try {
            b.render()
          }
          catch {}
        }, { priority: 'normal' })
      }
    }, delay)
    timers.push(t as unknown as number)
  }

  return () => {
    cancelled = true
    for (const t of timers) {
      clearTimeout(t)
    }
  }
}
