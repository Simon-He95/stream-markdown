// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('renders pending token lines with their matching code snapshot', async () => {
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

      const secondUpdate = renderer.updateCode('second\nline')
      await Promise.resolve()

      rafCallbacks.shift()?.(performance.now())
      await new Promise(r => setTimeout(r, 0))

      expect(container.querySelectorAll('code .line')).toHaveLength(1)
      expect(container.querySelector('code')?.textContent).toBe('first')

      resolveSecond({
        recall: 0,
        stable: [{ content: 'second' }, { content: '\n' }, { content: 'line' }],
        unstable: [],
      })
      await secondUpdate

      rafCallbacks.shift()?.(performance.now())
      await new Promise(r => setTimeout(r, 0))

      expect(container.querySelectorAll('code .line')).toHaveLength(2)
      expect(container.querySelector('code')?.textContent).toBe('second\nline')

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
