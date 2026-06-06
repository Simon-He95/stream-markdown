// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, getQueueLength, pause, resume } from '../packages/stream-markdown/src/utils/render-scheduler.js'
import { createShikiStreamCachedRenderer } from '../packages/stream-markdown/src/utils/shiki-stream-cached-renderer.js'

const shikiStreamMock = vi.hoisted(() => ({
  enqueueResults: [] as any[],
}))

vi.mock('shiki-stream', () => ({
  ShikiStreamTokenizer: class {
    enqueue = vi.fn(async () => shikiStreamMock.enqueueResults.shift() ?? { recall: 0, stable: [], unstable: [] })
    clear = vi.fn()
  },
}))

vi.mock('../packages/stream-markdown/src/utils/highlight.js', () => ({
  registerHighlight: vi.fn(async () => ({
    loadTheme: vi.fn(),
  })),
}))

describe('createShikiStreamCachedRenderer', () => {
  beforeEach(() => {
    shikiStreamMock.enqueueResults = []
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    ;(window as any).requestIdleCallback = (cb: IdleRequestCallback) => {
      return window.setTimeout(() => cb({ timeRemaining: () => 999, didTimeout: true }), 0)
    }
  })

  it('handles empty tokenizer chunks after theme changes', async () => {
    shikiStreamMock.enqueueResults.push(
      { recall: 0, stable: [{ content: 'const a = 1' }], unstable: [] },
      { recall: 0, stable: undefined, unstable: undefined },
    )

    const container = document.createElement('div')
    document.body.appendChild(container)
    const renderer = createShikiStreamCachedRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
      scheduleInRaf: false,
      throttleMs: 0,
    })

    await renderer.updateCode('const a = 1')
    await expect(renderer.setTheme('vitesse-light')).resolves.toBeUndefined()

    expect(renderer.getState().tokenCount).toBe(0)
    renderer.dispose()
  })

  it('cancels queued scheduled render on dispose', async () => {
    pause()
    clearAll()

    try {
      shikiStreamMock.enqueueResults.push({
        recall: 0,
        stable: [{ content: 'queued' }],
        unstable: [],
      })

      const container = document.createElement('div')
      document.body.appendChild(container)
      const renderer = createShikiStreamCachedRenderer(container, {
        lang: 'ts',
        theme: 'vitesse-dark',
      })

      await renderer.updateCode('queued')
      expect(getQueueLength()).toBeGreaterThan(0)

      renderer.dispose()
      expect(getQueueLength()).toBe(0)
    }
    finally {
      resume()
      clearAll()
    }
  })

  it('splits tokenizer tokens that contain embedded newlines', async () => {
    shikiStreamMock.enqueueResults.push({
      recall: 0,
      stable: [{
        content: 'first\nsecond',
        color: '#ff0000',
        fontStyle: 0,
      }],
      unstable: [],
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const renderer = createShikiStreamCachedRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
      scheduleInRaf: false,
      throttleMs: 0,
    })

    await renderer.updateCode('first\nsecond')
    await new Promise(r => setTimeout(r, 0))

    const lines = container.querySelectorAll('code .line')
    expect(lines).toHaveLength(2)
    expect(lines[0].textContent).toBe('first')
    expect(lines[1].textContent).toBe('second')

    renderer.dispose()
  })

  it('does not create an extra line when CRLF is split across tokenizer tokens', async () => {
    shikiStreamMock.enqueueResults.push({
      recall: 0,
      stable: [
        {
          content: 'first\r',
          color: '#ff0000',
          fontStyle: 0,
        },
        {
          content: '\nsecond',
          color: '#ff0000',
          fontStyle: 0,
        },
      ],
      unstable: [],
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const renderer = createShikiStreamCachedRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
      scheduleInRaf: false,
      throttleMs: 0,
    })

    await renderer.updateCode('first\r\nsecond')
    await new Promise(r => setTimeout(r, 0))

    const lines = container.querySelectorAll('code .line')
    expect(lines).toHaveLength(2)
    expect(lines[0].textContent).toBe('first')
    expect(lines[1].textContent).toBe('second')

    renderer.dispose()
  })

  it('cancels stale pending token renders when a newer cached update starts', async () => {
    const origRaf = (globalThis as any).requestAnimationFrame
    const origCancelRaf = (globalThis as any).cancelAnimationFrame
    const rafCallbacks: FrameRequestCallback[] = []
    ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    }
    ;(globalThis as any).cancelAnimationFrame = vi.fn()

    try {
      let resolveSecond!: (value: any) => void
      shikiStreamMock.enqueueResults.push(
        { recall: 0, stable: [{ content: 'first' }], unstable: [] },
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
      )

      const container = document.createElement('div')
      document.body.appendChild(container)
      const renderer = createShikiStreamCachedRenderer(container, {
        lang: 'ts',
        theme: 'vitesse-dark',
        throttleMs: 0,
      })

      await renderer.updateCode('first')

      const secondUpdate = renderer.updateCode('second')
      await Promise.resolve()

      rafCallbacks.shift()?.(performance.now())
      await new Promise(r => setTimeout(r, 0))

      expect(container.querySelector('code')).toBeNull()

      resolveSecond({
        recall: 0,
        stable: [{ content: 'second' }],
        unstable: [],
      })
      await secondUpdate

      rafCallbacks.shift()?.(performance.now())
      await new Promise(r => setTimeout(r, 0))

      expect(container.querySelector('code')?.textContent).toBe('second')

      renderer.dispose()
    }
    finally {
      if (origRaf === undefined)
        delete (globalThis as any).requestAnimationFrame
      else
        (globalThis as any).requestAnimationFrame = origRaf

      if (origCancelRaf === undefined)
        delete (globalThis as any).cancelAnimationFrame
      else
        (globalThis as any).cancelAnimationFrame = origCancelRaf
    }
  })
})
