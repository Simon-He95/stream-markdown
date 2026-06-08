// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, getQueueLength, pause, resume } from '../packages/stream-markdown/src/utils/render-scheduler.js'
import { createShikiStreamCachedRenderer } from '../packages/stream-markdown/src/utils/shiki-stream-cached-renderer.js'

const shikiStreamMock = vi.hoisted(() => ({
  enqueueResults: [] as Array<any | ((chunk: string) => any)>,
  chunks: [] as string[],
}))

const highlightMock = vi.hoisted(() => {
  const loadedThemes = new Set<string>(['vitesse-dark'])
  const loadTheme = vi.fn(async (theme: string) => {
    loadedThemes.add(theme)
  })
  const highlighter = {
    codeToThemedTokens(code: string) {
      return code.split('\n').map(line => [{ content: line }])
    },
    getTheme: vi.fn((theme: string) => {
      return loadedThemes.has(theme) ? { bg: '#000000' } : undefined
    }),
    loadTheme,
  }
  const registerHighlight = vi.fn(async (options?: { themes?: any[] }) => {
    for (const theme of options?.themes ?? []) {
      if (typeof theme === 'string')
        loadedThemes.add(theme)
    }
    return highlighter
  })

  return { highlighter, loadedThemes, loadTheme, registerHighlight }
})

vi.mock('shiki-stream', () => ({
  ShikiStreamTokenizer: class {
    enqueue = vi.fn(async (chunk: string) => {
      shikiStreamMock.chunks.push(chunk)
      const next = shikiStreamMock.enqueueResults.shift()
      return typeof next === 'function'
        ? next(chunk)
        : next ?? { recall: 0, stable: [], unstable: [] }
    })

    clear = vi.fn()
  },
}))

vi.mock('../packages/stream-markdown/src/utils/highlight.js', () => ({
  defaultLanguages: ['ts', 'tsx'],
  registerHighlight: highlightMock.registerHighlight,
}))

describe('createShikiStreamCachedRenderer', () => {
  beforeEach(() => {
    shikiStreamMock.enqueueResults = []
    shikiStreamMock.chunks = []
    highlightMock.loadedThemes.clear()
    highlightMock.loadedThemes.add('vitesse-dark')
    highlightMock.loadTheme.mockClear()
    highlightMock.highlighter.getTheme.mockClear()
    highlightMock.registerHighlight.mockClear()
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    ;(window as any).requestIdleCallback = (cb: IdleRequestCallback) => {
      return window.setTimeout(() => cb({ timeRemaining: () => 999, didTimeout: true }), 0)
    }
  })

  it('loads changed themes through registerHighlight', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const renderer = createShikiStreamCachedRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    await renderer.setTheme('vitesse-light')

    expect(highlightMock.loadTheme).not.toHaveBeenCalled()
    expect(highlightMock.registerHighlight).toHaveBeenCalledWith({
      langs: undefined,
      themes: ['vitesse-light'],
    })

    renderer.dispose()
  })

  it('registers dynamically updated languages', async () => {
    shikiStreamMock.enqueueResults.push(
      { recall: 0, stable: [{ content: 'const first = 1' }], unstable: [] },
      { recall: 0, stable: [{ content: 'const second = 2' }], unstable: [] },
    )

    const container = document.createElement('div')
    document.body.appendChild(container)

    const renderer = createShikiStreamCachedRenderer(container, {
      lang: 'ts',
      langs: ['ts'],
      theme: 'vitesse-dark',
      scheduleInRaf: false,
      throttleMs: 0,
    })

    await renderer.updateCode('const first = 1', 'ts')
    highlightMock.registerHighlight.mockClear()

    await renderer.updateCode('const second = 2', 'zig')

    expect(highlightMock.registerHighlight).toHaveBeenCalledWith({
      langs: ['ts', 'zig'],
      themes: undefined,
    })

    renderer.dispose()
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
    await new Promise(r => setTimeout(r, 0))

    expect(container.querySelector('code')?.textContent).toBe('const a = 1')
    expect(renderer.getState().tokenCount).toBe(0)
    renderer.dispose()
  })

  it('rehydrates token styles when the same cached code is updated again', async () => {
    shikiStreamMock.enqueueResults.push({
      recall: 0,
      stable: [{
        content: 'const a = 1',
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

    await renderer.updateCode('const a = 1')
    await new Promise(r => setTimeout(r, 0))

    expect(document.head.querySelector('style[data-stream-markdown-token-styles]')?.textContent)
      .toContain('color: #ff0000;')

    document.head.innerHTML = ''

    await renderer.updateCode('const a = 1')
    await new Promise(r => setTimeout(r, 0))

    expect(document.head.querySelector('style[data-stream-markdown-token-styles]')?.textContent)
      .toContain('color: #ff0000;')

    renderer.dispose()
  })

  it('renders initial empty code and re-renders it on theme changes', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const results: string[] = []
    const renderer = createShikiStreamCachedRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
      scheduleInRaf: false,
      throttleMs: 0,
      onResult: result => results.push(result),
    })

    await renderer.updateCode('')
    await new Promise(r => setTimeout(r, 0))

    expect(container.querySelector('pre')).not.toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('')
    expect(results).toEqual(['full'])

    results.length = 0

    await renderer.setTheme('vitesse-light')
    await new Promise(r => setTimeout(r, 0))

    expect(container.querySelector('pre')).not.toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('')
    expect(results).toEqual(['full'])

    renderer.dispose()
  })

  it('passes render options to the cached scheduled token updater', async () => {
    shikiStreamMock.enqueueResults.push({
      recall: 0,
      stable: [{ content: 'const a = 1' }],
      unstable: [],
    })

    const container = document.createElement('div')
    document.body.appendChild(container)

    const renderer = createShikiStreamCachedRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
      scheduleInRaf: false,
      throttleMs: 0,
      preClass: 'cached-pre',
      codeClass: 'cached-code',
      lineClass: 'cached-line',
      showLineNumbers: true,
      startingLineNumber: 7,
    })

    await renderer.updateCode('const a = 1')
    await new Promise(r => setTimeout(r, 0))

    expect(container.querySelector('pre')?.className).toBe('cached-pre')
    expect(container.querySelector('code')?.className).toBe('cached-code')
    expect(container.querySelectorAll('code .cached-line')).toHaveLength(1)
    expect(container.querySelector('code .cached-line .line-number')?.getAttribute('data-line')).toBe('7')

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

  it('falls back to full tokenization when buffered tokens do not reconstruct the code', async () => {
    shikiStreamMock.enqueueResults.push({
      recall: 0,
      stable: [
        { content: 'first' },
        { content: 'second' },
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

    await renderer.updateCode('first\nsecond')
    await new Promise(r => setTimeout(r, 0))

    const lines = container.querySelectorAll('code .line')
    expect(lines).toHaveLength(2)
    expect(lines[0].textContent).toBe('first')
    expect(lines[1].textContent).toBe('second')
    expect(container.querySelector('code')?.textContent).toBe('first\nsecond')

    renderer.dispose()
  })

  it('retokenizes the full code after fallback rendering from an empty token buffer', async () => {
    shikiStreamMock.enqueueResults.push(
      { recall: 0, stable: [{ content: '' }], unstable: [] },
      (chunk: string) => ({
        recall: 0,
        stable: [{ content: chunk }],
        unstable: [],
      }),
    )

    const container = document.createElement('div')
    document.body.appendChild(container)

    const renderer = createShikiStreamCachedRenderer(container, {
      lang: 'ts',
      theme: 'vitesse-dark',
      scheduleInRaf: false,
      throttleMs: 0,
    })

    await renderer.updateCode('first')
    await new Promise(r => setTimeout(r, 0))

    expect(container.querySelector('code')?.textContent).toBe('first')

    await renderer.updateCode('first second')
    await new Promise(r => setTimeout(r, 0))

    expect(shikiStreamMock.chunks).toEqual(['first', 'first second'])
    expect(container.querySelector('code')?.textContent).toBe('first second')

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

  it('does not run a stale cached renderer job after cancellation', async () => {
    const jobs: Array<() => void> = []

    vi.resetModules()
    vi.doMock('../packages/stream-markdown/src/utils/render-scheduler.js', () => ({
      scheduleRenderJob: vi.fn((job: () => void) => {
        jobs.push(job)
        return vi.fn()
      }),
      setTimeBudget: vi.fn(),
    }))

    let renderer: ReturnType<typeof createShikiStreamCachedRenderer> | null = null

    try {
      const { createShikiStreamCachedRenderer: createMockedRenderer } = await import('../packages/stream-markdown/src/utils/shiki-stream-cached-renderer.js')

      ;(window as any).requestIdleCallback = (cb: IdleRequestCallback) => {
        cb({ timeRemaining: () => 999, didTimeout: true } as IdleDeadline)
        return 1
      }
      ;(window as any).cancelIdleCallback = vi.fn()

      shikiStreamMock.enqueueResults.push(
        { recall: 0, stable: [{ content: 'old' }], unstable: [] },
        { recall: 0, stable: [{ content: 'new' }], unstable: [] },
      )

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

  it('does not run a stale same-code cached renderer job after rescheduling', async () => {
    const jobs: Array<() => void> = []

    vi.resetModules()
    vi.doMock('../packages/stream-markdown/src/utils/render-scheduler.js', () => ({
      scheduleRenderJob: vi.fn((job: () => void) => {
        jobs.push(job)
        return vi.fn()
      }),
      setTimeBudget: vi.fn(),
    }))

    let renderer: ReturnType<typeof createShikiStreamCachedRenderer> | null = null

    try {
      const { createShikiStreamCachedRenderer: createMockedRenderer } = await import('../packages/stream-markdown/src/utils/shiki-stream-cached-renderer.js')

      ;(window as any).requestIdleCallback = (cb: IdleRequestCallback) => {
        cb({ timeRemaining: () => 999, didTimeout: true } as IdleDeadline)
        return 1
      }
      ;(window as any).cancelIdleCallback = vi.fn()

      shikiStreamMock.enqueueResults.push({
        recall: 0,
        stable: [{ content: 'same' }],
        unstable: [],
      })

      const container = document.createElement('div')
      document.body.appendChild(container)
      renderer = createMockedRenderer(container, {
        lang: 'ts',
        theme: 'vitesse-dark',
        throttleMs: 0,
      })

      await renderer.updateCode('same')
      await renderer.updateCode('same')

      expect(jobs).toHaveLength(2)

      jobs[0]()
      expect(container.querySelector('code')).toBeNull()

      jobs[1]()
      expect(container.querySelector('code')?.textContent).toBe('same')
    }
    finally {
      renderer?.dispose()
      vi.doUnmock('../packages/stream-markdown/src/utils/render-scheduler.js')
      vi.resetModules()
    }
  })
})
