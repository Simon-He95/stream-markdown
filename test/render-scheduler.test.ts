// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, drain, getQueueLength, getTimeBudget, pause, resume, scheduleRenderJob, setTimeBudget } from '../packages/stream-markdown/src/utils/render-scheduler.js'

describe('render scheduler', () => {
  beforeEach(() => {
    clearAll()
    pause()
  })

  it('keeps high priority jobs FIFO while still running them before normal jobs', () => {
    const order: string[] = []

    scheduleRenderJob(() => order.push('normal-1'))
    scheduleRenderJob(() => order.push('high-1'), { priority: 'high' })
    scheduleRenderJob(() => order.push('high-2'), { priority: 'high' })
    scheduleRenderJob(() => order.push('normal-2'))

    drain()

    expect(order).toEqual(['high-1', 'high-2', 'normal-1', 'normal-2'])
  })

  it('ignores non-finite time budgets', () => {
    const original = getTimeBudget()

    try {
      setTimeBudget(4)
      setTimeBudget(Infinity)

      expect(getTimeBudget()).toBe(4)
    }
    finally {
      setTimeBudget(original)
    }
  })

  afterEach(() => {
    resume()
    clearAll()
  })

  it('does not run an already scheduled frame after pause', () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame

    const rafCallbacks: FrameRequestCallback[] = []
    const requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    const cancelAnimationFrame = vi.fn()

    try {
      ;(globalThis as any).requestAnimationFrame = requestAnimationFrame
      ;(globalThis as any).cancelAnimationFrame = cancelAnimationFrame
      ;(window as any).requestAnimationFrame = requestAnimationFrame
      ;(window as any).cancelAnimationFrame = cancelAnimationFrame

      resume()

      const order: string[] = []
      scheduleRenderJob(() => order.push('run'))

      expect(rafCallbacks).toHaveLength(1)

      pause()
      expect(cancelAnimationFrame).toHaveBeenCalledWith(1)

      rafCallbacks.shift()?.(performance.now())

      expect(order).toEqual([])
      expect(getQueueLength()).toBe(1)

      resume()

      expect(rafCallbacks).toHaveLength(1)
      rafCallbacks.shift()?.(performance.now())

      expect(order).toEqual(['run'])
      expect(getQueueLength()).toBe(0)
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })

  it('invalidates a cancelled frame callback even if it fires after resume', () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame

    const rafCallbacks: FrameRequestCallback[] = []
    const requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    const cancelAnimationFrame = vi.fn()

    try {
      ;(globalThis as any).requestAnimationFrame = requestAnimationFrame
      ;(globalThis as any).cancelAnimationFrame = cancelAnimationFrame
      ;(window as any).requestAnimationFrame = requestAnimationFrame
      ;(window as any).cancelAnimationFrame = cancelAnimationFrame

      resume()

      const order: string[] = []
      scheduleRenderJob(() => order.push('run'))

      expect(rafCallbacks).toHaveLength(1)

      pause()
      expect(cancelAnimationFrame).toHaveBeenCalledWith(1)

      resume()
      expect(rafCallbacks).toHaveLength(2)

      rafCallbacks[0]?.(performance.now())

      expect(order).toEqual([])
      expect(getQueueLength()).toBe(1)

      rafCallbacks[1]?.(performance.now())

      expect(order).toEqual(['run'])
      expect(getQueueLength()).toBe(0)
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })

  it('cancels only its own queued job when the same function is scheduled more than once', () => {
    const order: string[] = []
    const sharedJob = () => order.push('shared')

    scheduleRenderJob(sharedJob)
    scheduleRenderJob(() => order.push('middle'))
    const cancelLastSharedJob = scheduleRenderJob(sharedJob)

    cancelLastSharedJob()
    drain()

    expect(order).toEqual(['shared', 'middle'])
  })

  it('cancels the pending frame when the last queued job is cancelled', () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame
    const requestAnimationFrame = vi.fn(() => 123)
    const cancelAnimationFrame = vi.fn()

    try {
      ;(globalThis as any).requestAnimationFrame = requestAnimationFrame
      ;(globalThis as any).cancelAnimationFrame = cancelAnimationFrame
      ;(window as any).requestAnimationFrame = requestAnimationFrame
      ;(window as any).cancelAnimationFrame = cancelAnimationFrame

      resume()
      const cancel = scheduleRenderJob(() => {})
      cancel()

      expect(requestAnimationFrame).toHaveBeenCalled()
      expect(cancelAnimationFrame).toHaveBeenCalledWith(123)
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })

  it('does not schedule a frame when resuming an empty queue', () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame
    const requestAnimationFrame = vi.fn(() => 123)
    const cancelAnimationFrame = vi.fn()

    try {
      ;(globalThis as any).requestAnimationFrame = requestAnimationFrame
      ;(globalThis as any).cancelAnimationFrame = cancelAnimationFrame
      ;(window as any).requestAnimationFrame = requestAnimationFrame
      ;(window as any).cancelAnimationFrame = cancelAnimationFrame

      resume()

      expect(requestAnimationFrame).not.toHaveBeenCalled()
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })

  it('falls back to setTimeout when requestAnimationFrame is unavailable', async () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame

    try {
      delete (globalThis as any).requestAnimationFrame
      delete (globalThis as any).cancelAnimationFrame
      delete (window as any).requestAnimationFrame
      delete (window as any).cancelAnimationFrame

      const order: string[] = []
      scheduleRenderJob(() => order.push('run'))

      resume()
      await new Promise(resolve => setTimeout(resolve, 25))

      expect(order).toEqual(['run'])
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })

  it('falls back to setTimeout when requestAnimationFrame cannot be cancelled', async () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame
    const requestAnimationFrame = vi.fn(() => 123)

    try {
      ;(globalThis as any).requestAnimationFrame = requestAnimationFrame
      delete (globalThis as any).cancelAnimationFrame
      ;(window as any).requestAnimationFrame = requestAnimationFrame
      delete (window as any).cancelAnimationFrame

      const order: string[] = []
      scheduleRenderJob(() => order.push('run'))

      resume()
      await new Promise(resolve => setTimeout(resolve, 25))

      expect(requestAnimationFrame).not.toHaveBeenCalled()
      expect(order).toEqual(['run'])
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })

  it('falls back to setTimeout when requestAnimationFrame throws', async () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame

    try {
      ;(globalThis as any).requestAnimationFrame = () => {
        throw new Error('closed frame')
      }
      ;(globalThis as any).cancelAnimationFrame = vi.fn()
      ;(window as any).requestAnimationFrame = (globalThis as any).requestAnimationFrame
      ;(window as any).cancelAnimationFrame = vi.fn()

      resume()
      const order: string[] = []
      scheduleRenderJob(() => order.push('run'))
      await new Promise(resolve => setTimeout(resolve, 25))

      expect(order).toEqual(['run'])
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })

  it('ignores a stale frame callback queued before requestAnimationFrame throws', async () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame
    const rafCallbacks: FrameRequestCallback[] = []

    try {
      ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb)
        throw new Error('closed frame')
      }
      ;(globalThis as any).cancelAnimationFrame = vi.fn()
      ;(window as any).requestAnimationFrame = (globalThis as any).requestAnimationFrame
      ;(window as any).cancelAnimationFrame = vi.fn()

      resume()
      const order: string[] = []
      scheduleRenderJob(() => order.push('run'))

      expect(rafCallbacks).toHaveLength(1)

      rafCallbacks[0]?.(performance.now())
      expect(order).toEqual([])

      await new Promise(resolve => setTimeout(resolve, 25))
      expect(order).toEqual(['run'])
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })

  it('does not leave a stale frame handle when requestAnimationFrame runs synchronously', () => {
    const origGlobalRaf = (globalThis as any).requestAnimationFrame
    const origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    const origWindowRaf = (window as any).requestAnimationFrame
    const origWindowCancelRaf = (window as any).cancelAnimationFrame

    try {
      const requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
        cb(performance.now())
        return 123
      })
      const cancelAnimationFrame = vi.fn()

      ;(globalThis as any).requestAnimationFrame = requestAnimationFrame
      ;(globalThis as any).cancelAnimationFrame = cancelAnimationFrame
      ;(window as any).requestAnimationFrame = requestAnimationFrame
      ;(window as any).cancelAnimationFrame = cancelAnimationFrame

      resume()

      const order: string[] = []
      scheduleRenderJob(() => order.push('first'))
      scheduleRenderJob(() => order.push('second'))

      expect(order).toEqual(['first', 'second'])
      expect(cancelAnimationFrame).not.toHaveBeenCalled()
    }
    finally {
      if (origGlobalRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origGlobalRaf

      if (origGlobalCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origGlobalCancelRaf

      if (origWindowRaf === undefined)
        delete (window as any).requestAnimationFrame
      else
        (window as any).requestAnimationFrame = origWindowRaf

      if (origWindowCancelRaf === undefined)
        delete (window as any).cancelAnimationFrame
      else
        (window as any).cancelAnimationFrame = origWindowCancelRaf
    }
  })
})
