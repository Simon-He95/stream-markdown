// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, drain, pause, resume, scheduleRenderJob } from '../packages/stream-markdown/src/utils/render-scheduler.js'

describe('render scheduler', () => {
  beforeEach(() => {
    clearAll()
    pause()
  })

  afterEach(() => {
    resume()
    clearAll()
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
})
