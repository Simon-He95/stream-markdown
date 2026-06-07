// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll } from '../packages/stream-markdown/src/utils/render-scheduler.js'
import { createShikiStreamRenderer } from '../packages/stream-markdown/src/utils/shiki-stream-renderer.js'

vi.mock('../packages/stream-markdown/src/utils/highlight.js', () => ({
  registerHighlight: vi.fn(async () => ({
    codeToThemedTokens(code: string) {
      return code.split('\n').map(line => [{ content: line }])
    },
    loadTheme: vi.fn(),
  })),
}))

function restoreGlobal(target: any, key: string, value: any) {
  if (value === undefined)
    delete target[key]
  else
    target[key] = value
}

describe('createShikiStreamRenderer', () => {
  let origGlobalRaf: any
  let origGlobalCancelRaf: any
  let origWindowRaf: any
  let origWindowCancelRaf: any
  let origGlobalRic: any
  let origWindowRic: any

  beforeEach(() => {
    clearAll()
    document.body.innerHTML = ''
    document.head.innerHTML = ''

    origGlobalRaf = (globalThis as any).requestAnimationFrame
    origGlobalCancelRaf = (globalThis as any).cancelAnimationFrame
    origWindowRaf = (window as any).requestAnimationFrame
    origWindowCancelRaf = (window as any).cancelAnimationFrame
    origGlobalRic = (globalThis as any).requestIdleCallback
    origWindowRic = (window as any).requestIdleCallback
  })

  afterEach(() => {
    clearAll()

    restoreGlobal(globalThis as any, 'requestAnimationFrame', origGlobalRaf)
    restoreGlobal(globalThis as any, 'cancelAnimationFrame', origGlobalCancelRaf)
    restoreGlobal(window as any, 'requestAnimationFrame', origWindowRaf)
    restoreGlobal(window as any, 'cancelAnimationFrame', origWindowCancelRaf)
    restoreGlobal(globalThis as any, 'requestIdleCallback', origGlobalRic)
    restoreGlobal(window as any, 'requestIdleCallback', origWindowRic)
  })

  it('cancels stale idle token updates when newer code arrives', async () => {
    const rafCallbacks: FrameRequestCallback[] = []
    const idleCallbacks: IdleRequestCallback[] = []

    const requestAnimationFrameMock = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    }
    const requestIdleCallbackMock = (cb: IdleRequestCallback) => {
      idleCallbacks.push(cb)
      return idleCallbacks.length
    }

    ;(globalThis as any).requestAnimationFrame = requestAnimationFrameMock
    ;(globalThis as any).cancelAnimationFrame = vi.fn()
    ;(window as any).requestAnimationFrame = requestAnimationFrameMock
    ;(window as any).cancelAnimationFrame = vi.fn()
    ;(globalThis as any).requestIdleCallback = requestIdleCallbackMock
    ;(window as any).requestIdleCallback = requestIdleCallbackMock

    const container = document.createElement('div')
    document.body.appendChild(container)

    const renderer = createShikiStreamRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 0,
    })

    await renderer.updateCode('first')

    expect(rafCallbacks).toHaveLength(1)
    rafCallbacks.shift()?.(performance.now())

    expect(idleCallbacks).toHaveLength(1)

    await renderer.updateCode('second')

    idleCallbacks.shift()?.({
      didTimeout: true,
      timeRemaining: () => 999,
    } as IdleDeadline)

    expect(container.querySelector('code')).toBeNull()

    expect(rafCallbacks).toHaveLength(1)
    rafCallbacks.shift()?.(performance.now())

    expect(idleCallbacks).toHaveLength(1)
    idleCallbacks.shift()?.({
      didTimeout: true,
      timeRemaining: () => 999,
    } as IdleDeadline)

    expect(container.querySelector('code')?.textContent).toBe('second')

    renderer.dispose()
  })

  it('passes render options to the scheduled token updater', async () => {
    const rafCallbacks: FrameRequestCallback[] = []
    const idleCallbacks: IdleRequestCallback[] = []

    const requestAnimationFrameMock = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    }
    const requestIdleCallbackMock = (cb: IdleRequestCallback) => {
      idleCallbacks.push(cb)
      return idleCallbacks.length
    }

    ;(globalThis as any).requestAnimationFrame = requestAnimationFrameMock
    ;(globalThis as any).cancelAnimationFrame = vi.fn()
    ;(window as any).requestAnimationFrame = requestAnimationFrameMock
    ;(window as any).cancelAnimationFrame = vi.fn()
    ;(globalThis as any).requestIdleCallback = requestIdleCallbackMock
    ;(window as any).requestIdleCallback = requestIdleCallbackMock

    const container = document.createElement('div')
    document.body.appendChild(container)

    const renderer = createShikiStreamRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 0,
      preClass: 'custom-pre',
      codeClass: 'custom-code',
      lineClass: 'custom-line',
      showLineNumbers: true,
      startingLineNumber: 10,
    })

    await renderer.updateCode('const a = 1')

    rafCallbacks.shift()?.(performance.now())
    idleCallbacks.shift()?.({
      didTimeout: true,
      timeRemaining: () => 999,
    } as IdleDeadline)

    expect(container.querySelector('pre')?.className).toBe('custom-pre')
    expect(container.querySelector('code')?.className).toBe('custom-code')
    expect(container.querySelectorAll('code .custom-line')).toHaveLength(1)
    expect(container.querySelector('code .custom-line .line-number')?.getAttribute('data-line')).toBe('10')

    renderer.dispose()
  })

  it('does not run a stale stream renderer job after cancellation', async () => {
    const jobs: Array<() => void> = []

    vi.resetModules()
    vi.doMock('../packages/stream-markdown/src/utils/render-scheduler.js', () => ({
      scheduleRenderJob: vi.fn((job: () => void) => {
        jobs.push(job)
        return vi.fn()
      }),
      setTimeBudget: vi.fn(),
    }))

    let renderer: ReturnType<typeof createShikiStreamRenderer> | null = null

    try {
      const { createShikiStreamRenderer: createMockedRenderer } = await import('../packages/stream-markdown/src/utils/shiki-stream-renderer.js')

      ;(window as any).requestIdleCallback = (cb: IdleRequestCallback) => {
        cb({ timeRemaining: () => 999, didTimeout: true } as IdleDeadline)
        return 1
      }
      ;(window as any).cancelIdleCallback = vi.fn()

      const container = document.createElement('div')
      document.body.appendChild(container)

      renderer = createMockedRenderer(container, {
        lang: 'ts',
        theme: 'vitesse-dark',
        throttleMs: 0,
      })

      await renderer.updateCode('old')
      await renderer.updateCode('new')

      expect(jobs).toHaveLength(2)

      jobs[0]()
      expect(container.querySelector('code')).toBeNull()

      jobs[1]()
      expect(container.querySelector('code')?.textContent).toBe('new')
    }
    finally {
      renderer?.dispose()
      vi.doUnmock('../packages/stream-markdown/src/utils/render-scheduler.js')
      vi.resetModules()
    }
  })
})
