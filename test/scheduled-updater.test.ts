// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScheduledTokenIncrementalUpdater } from '../packages/stream-markdown/src/utils/incremental-tokens.js'

// Minimal highlighter stub similar to other tests
const hl = {
  codeToThemedTokens(code: string) {
    return code.split('\n').map(line => [{ content: line }])
  },
  codeToHtml(code: string) {
    return `<pre><code>${code}</code></pre>`
  },
}

const futureDependentHl = {
  codeToThemedTokens(code: string) {
    const color = code.includes('END') ? '#ff0000' : '#0000ff'
    return code.split('\n').map(line => [{
      content: line,
      color,
      fontStyle: 0,
    }])
  },
}

describe('createScheduledTokenIncrementalUpdater (scheduler)', () => {
  let origRIC: any
  let origIO: any

  beforeEach(() => {
    // Make requestIdleCallback deterministic for tests (safe if not present)
    origRIC = (globalThis as any).requestIdleCallback ?? undefined
    const ricImpl = (cb: IdleRequestCallback) => {
      return window.setTimeout(() => cb({ timeRemaining: () => 999, didTimeout: true }), 0)
    }
    globalThis.requestIdleCallback = ricImpl
    // also ensure window.requestIdleCallback exists in jsdom environment
    if ((globalThis as any).window)
      (globalThis as any).window.requestIdleCallback = ricImpl

    // Simple IntersectionObserver stub that marks observed elements as visible by default
    origIO = (globalThis as any).IntersectionObserver ?? undefined
    ;(globalThis as any).IntersectionObserver = class {
      cb: any
      constructor(cb: any) {
        this.cb = cb
      }

      observe(el: Element) {
        this.cb([{ target: el, isIntersecting: true }])
      }

      unobserve() {}
      disconnect() {}
    }
  })

  afterEach(() => {
    if (origRIC === undefined) {
      delete (globalThis as any).requestIdleCallback
      if ((globalThis as any).window)
        delete (globalThis as any).window.requestIdleCallback
    }
    else {
      (globalThis as any).requestIdleCallback = origRIC
      if ((globalThis as any).window)
        (globalThis as any).window.requestIdleCallback = origRIC
    }

    if (origIO === undefined)
      delete (globalThis as any).IntersectionObserver
    else
      (globalThis as any).IntersectionObserver = origIO
  })

  it('calls onResult after scheduled update and update() returns noop', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const results: string[] = []
    const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      onResult: (r: string) => results.push(r),
    })

    const ret = updater.update('a')
    expect(ret).toBe('noop')

    // Wait a tick for the requestIdleCallback to have run
    await new Promise(r => setTimeout(r, 0))

    expect(results).toHaveLength(1)
    expect(['full', 'incremental', 'noop']).toContain(results[0])
  })

  it('isolates onResult errors from scheduled rendering', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = document.createElement('div')
    document.body.appendChild(container)

    const results: string[] = []
    const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      onResult: (result: string) => {
        results.push(result)
        throw new Error('consumer callback failed')
      },
    })

    updater.update('a')
    await new Promise(r => setTimeout(r, 0))

    expect(results).toEqual(['full'])
    expect(container.querySelector('code')?.textContent).toBe('a')
    expect(consoleError).toHaveBeenCalledTimes(1)

    updater.dispose()
    consoleError.mockRestore()
  })

  it('continues processing after a synchronous requestIdleCallback', async () => {
    vi.resetModules()

    const origGlobalRIC = (globalThis as any).requestIdleCallback
    const origWindowRIC = (window as any).requestIdleCallback
    const syncRic = (cb: IdleRequestCallback) => {
      cb({ timeRemaining: () => 999, didTimeout: true } as IdleDeadline)
      return 1
    }

    ;(globalThis as any).requestIdleCallback = syncRic
    ;(window as any).requestIdleCallback = syncRic

    try {
      const { createScheduledTokenIncrementalUpdater } = await import('../packages/stream-markdown/src/utils/incremental-tokens.js')
      const container = document.createElement('div')
      document.body.appendChild(container)

      const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
        lang: 'ts',
        theme: 'vitesse-dark',
      })

      updater.update('first')
      expect(container.querySelector('code')?.textContent).toBe('first')

      updater.update('second')
      expect(container.querySelector('code')?.textContent).toBe('second')

      updater.dispose()
    }
    finally {
      ;(globalThis as any).requestIdleCallback = origGlobalRIC
      ;(window as any).requestIdleCallback = origWindowRIC
      vi.resetModules()
    }
  })

  it('uses the global requestIdleCallback receiver when window has none', async () => {
    const idleCallbacks: IdleRequestCallback[] = []

    delete (window as any).requestIdleCallback
    ;(globalThis as any).requestIdleCallback = function (this: unknown, cb: IdleRequestCallback) {
      expect(this).toBe(globalThis)
      idleCallbacks.push(cb)
      return idleCallbacks.length
    }

    const container = document.createElement('div')
    document.body.appendChild(container)

    const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 0,
    })

    updater.update('global')
    expect(idleCallbacks).toHaveLength(1)

    idleCallbacks.shift()?.({ timeRemaining: () => 999, didTimeout: true } as IdleDeadline)
    expect(container.querySelector('code')?.textContent).toBe('global')

    updater.dispose()
  })

  it('deduplicates multiple updates for the same container, only last applied', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const results: string[] = []
    const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 0,
      onResult: (r: string) => results.push(r),
    })

    updater.update('first')
    updater.update('second')
    updater.update('final')

    await new Promise(r => setTimeout(r, 0))

    expect(results).toEqual(['full'])
    expect(container.querySelector('code')?.textContent).toBe('final')

    updater.dispose()
  })

  it('does not let an older updater cancel a newer task for the same container', async () => {
    const idleCallbacks: IdleRequestCallback[] = []
    const ricImpl = (cb: IdleRequestCallback) => {
      idleCallbacks.push(cb)
      return idleCallbacks.length
    }
    globalThis.requestIdleCallback = ricImpl
    window.requestIdleCallback = ricImpl

    const container = document.createElement('div')
    document.body.appendChild(container)

    const first = createScheduledTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 0,
    })
    const second = createScheduledTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 0,
    })

    first.update('old')
    second.update('new')
    first.cancel?.()

    expect(idleCallbacks).toHaveLength(1)
    idleCallbacks.shift()?.({ timeRemaining: () => 999, didTimeout: true } as IdleDeadline)

    expect(container.querySelector('code')?.textContent).toBe('new')

    first.dispose()
    second.dispose()
  })

  it('keeps a follow-up task scheduled from onResult observed', async () => {
    vi.resetModules()

    const observe = vi.fn()
    const unobserve = vi.fn()
    const idleCallbacks: IdleRequestCallback[] = []
    const origGlobalIO = (globalThis as any).IntersectionObserver
    const origWindowIO = (window as any).IntersectionObserver
    const origGlobalRIC = (globalThis as any).requestIdleCallback
    const origWindowRIC = (window as any).requestIdleCallback

    class MockIntersectionObserver {
      observe = observe
      unobserve = unobserve
    }

    ;(globalThis as any).IntersectionObserver = MockIntersectionObserver
    ;(window as any).IntersectionObserver = MockIntersectionObserver
    ;(globalThis as any).requestIdleCallback = (cb: IdleRequestCallback) => {
      idleCallbacks.push(cb)
      return idleCallbacks.length
    }
    ;(window as any).requestIdleCallback = (globalThis as any).requestIdleCallback

    try {
      const { createScheduledTokenIncrementalUpdater } = await import('../packages/stream-markdown/src/utils/incremental-tokens.js')
      const container = document.createElement('div')
      document.body.appendChild(container)

      const results: string[] = []

      const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
        lang: 'ts',
        theme: 'vitesse-dark',
        throttleMs: 0,
        onResult: (result) => {
          results.push(result)
          if (results.length === 1)
            updater.update('second')
        },
      })

      updater.update('first')

      let calls = 0
      idleCallbacks.shift()?.({
        didTimeout: true,
        timeRemaining: () => calls++ === 0 ? 999 : 0,
      } as IdleDeadline)

      expect(unobserve).not.toHaveBeenCalledWith(container)
      expect(container.querySelector('code')?.textContent).toBe('first')

      idleCallbacks.shift()?.({ didTimeout: true, timeRemaining: () => 999 } as IdleDeadline)
      expect(container.querySelector('code')?.textContent).toBe('second')

      updater.dispose()
    }
    finally {
      if (origGlobalIO === undefined)
        delete (globalThis as any).IntersectionObserver
      else
        (globalThis as any).IntersectionObserver = origGlobalIO

      if (origWindowIO === undefined)
        delete (window as any).IntersectionObserver
      else
        (window as any).IntersectionObserver = origWindowIO

      if (origGlobalRIC === undefined)
        delete (globalThis as any).requestIdleCallback
      else
        (globalThis as any).requestIdleCallback = origGlobalRIC

      if (origWindowRIC === undefined)
        delete (window as any).requestIdleCallback
      else
        (window as any).requestIdleCallback = origWindowRIC

      vi.resetModules()
    }
  })

  it('coalesces updates during the throttle window', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 10,
    })

    updater.update('first')
    updater.update('final')

    await new Promise(r => setTimeout(r, 5))
    expect(container.querySelector('code')).toBeNull()

    await new Promise(r => setTimeout(r, 15))

    expect(container.querySelector('code')?.textContent).toBe('final')
  })

  it('cancels a queued stale update when a newer throttled update arrives before idle work runs', async () => {
    const idleCallbacks: IdleRequestCallback[] = []
    const ricImpl = (cb: IdleRequestCallback) => {
      idleCallbacks.push(cb)
      return idleCallbacks.length
    }
    globalThis.requestIdleCallback = ricImpl
    window.requestIdleCallback = ricImpl

    const container = document.createElement('div')
    document.body.appendChild(container)

    const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 10,
    })

    updater.update('first')
    await new Promise(r => setTimeout(r, 15))
    expect(idleCallbacks).toHaveLength(1)

    updater.update('final')

    idleCallbacks.shift()?.({ timeRemaining: () => 999, didTimeout: true } as IdleDeadline)
    expect(container.querySelector('code')).toBeNull()

    await new Promise(r => setTimeout(r, 15))
    expect(idleCallbacks).toHaveLength(1)

    idleCallbacks.shift()?.({ timeRemaining: () => 999, didTimeout: true } as IdleDeadline)
    expect(container.querySelector('code')?.textContent).toBe('final')

    updater.dispose()
  })

  it('does not enable appendOnlyFastPath by default', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const updater = createScheduledTokenIncrementalUpdater(container, futureDependentHl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      throttleMs: 0,
    })

    updater.update('a\n')
    await new Promise(r => setTimeout(r, 0))

    const firstClassBefore = (container.querySelector('code .line:first-child span') as HTMLElement).className

    updater.update('a\nEND')
    await new Promise(r => setTimeout(r, 0))

    const firstClassAfter = (container.querySelector('code .line:first-child span') as HTMLElement).className

    expect(firstClassAfter).not.toBe(firstClassBefore)

    updater.dispose()
  })

  // Note: starvation regression is covered by integration manual testing due to
  // jsdom/requestIdleCallback variability across environments.
})
