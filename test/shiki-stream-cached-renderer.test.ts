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
})
