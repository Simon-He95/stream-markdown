// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { disposeHighlighter, registerHighlight } from '../packages/stream-markdown/src/utils/highlight.js'

describe('registerHighlight', () => {
  it('loads newly requested themes even after the highlighter is already created', async () => {
    disposeHighlighter()

    // First call creates the singleton highlighter with defaults.
    await registerHighlight()

    // Later call requests an additional bundled theme.
    const hl = await registerHighlight({ themes: ['andromeeda'] as any })

    // Should not throw "Theme not found".
    expect(() => hl.codeToHtml('const a = 1', { lang: 'typescript', theme: 'andromeeda' })).not.toThrow()
  }, 30000)

  it('invalidates cached token HTML when a same-name custom theme is loaded', async () => {
    vi.resetModules()

    const theme1 = { name: 'reload-test', color: '#ff0000' }
    const theme2 = { name: 'reload-test', color: '#0000ff' }
    let color = ''

    const highlighter = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{ content: line, color }])
      },
      async loadTheme(theme: typeof theme1) {
        color = theme.color
      },
    }

    vi.doMock('shiki', () => ({
      createHighlighter: vi.fn(async ({ themes }: { themes: Array<typeof theme1> }) => {
        for (const theme of themes)
          await highlighter.loadTheme(theme)
        return highlighter
      }),
    }))

    try {
      const { disposeHighlighter, registerHighlight } = await import('../packages/stream-markdown/src/utils/highlight.js')
      const { renderCodeWithTokens } = await import('../packages/stream-markdown/src/utils/shiki-render.js')

      const hl = await registerHighlight({ langs: ['ts'], themes: [theme1 as any] })
      const opts = {
        lang: 'ts',
        theme: 'reload-test',
        htmlCache: true,
        tokenCache: true,
      }

      const html1 = renderCodeWithTokens(hl as any, 'const a = 1', opts)
      await registerHighlight({ langs: ['ts'], themes: [theme2 as any] })
      const html2 = renderCodeWithTokens(hl as any, 'const a = 1', opts)

      expect(html1).toContain('color: #ff0000;')
      expect(html2).toContain('color: #0000ff;')
      expect(html2).not.toBe(html1)

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('does not reload an unchanged same-object custom theme', async () => {
    vi.resetModules()

    const theme = { name: 'stable-theme', color: '#ff0000' }
    const loadTheme = vi.fn(async (nextTheme: typeof theme) => nextTheme.color)

    const highlighter = {
      async loadTheme(nextTheme: typeof theme) {
        await loadTheme(nextTheme)
      },
      async loadLanguage() {},
    }

    vi.doMock('shiki', () => ({
      createHighlighter: vi.fn(async ({ themes }: { themes: Array<typeof theme> }) => {
        for (const nextTheme of themes)
          await highlighter.loadTheme(nextTheme)
        return highlighter
      }),
    }))

    try {
      const { disposeHighlighter, registerHighlight } = await import('../packages/stream-markdown/src/utils/highlight.js')

      await registerHighlight({ langs: ['ts'], themes: [theme as any] })
      await registerHighlight({ langs: ['ts'], themes: [theme as any] })

      expect(loadTheme).toHaveBeenCalledTimes(1)

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('reloads a mutated same-object custom theme', async () => {
    vi.resetModules()

    const theme = { name: 'mutable-theme', color: '#ff0000' }
    let color = ''

    const highlighter = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{ content: line, color }])
      },
      async loadTheme(nextTheme: typeof theme) {
        color = nextTheme.color
      },
    }

    vi.doMock('shiki', () => ({
      createHighlighter: vi.fn(async ({ themes }: { themes: Array<typeof theme> }) => {
        for (const nextTheme of themes)
          await highlighter.loadTheme(nextTheme)
        return highlighter
      }),
    }))

    try {
      const { disposeHighlighter, registerHighlight } = await import('../packages/stream-markdown/src/utils/highlight.js')
      const { renderCodeWithTokens } = await import('../packages/stream-markdown/src/utils/shiki-render.js')

      const hl = await registerHighlight({ langs: ['ts'], themes: [theme as any] })
      const opts = {
        lang: 'ts',
        theme: 'mutable-theme',
        htmlCache: true,
        tokenCache: true,
      }

      expect(renderCodeWithTokens(hl as any, 'const a = 1', opts))
        .toContain('color: #ff0000;')

      theme.color = '#0000ff'
      await registerHighlight({ langs: ['ts'], themes: [theme as any] })

      expect(renderCodeWithTokens(hl as any, 'const a = 1', opts))
        .toContain('color: #0000ff;')

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('uses the latest same-name custom theme registered before initial creation settles', async () => {
    vi.resetModules()

    const theme1 = { name: 'race-theme', color: '#ff0000' }
    const theme2 = { name: 'race-theme', color: '#0000ff' }
    let color = ''

    const highlighter = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{ content: line, color }])
      },
      async loadTheme(theme: typeof theme1) {
        color = theme.color
      },
    }

    vi.doMock('shiki', () => ({
      createHighlighter: vi.fn(async ({ themes }: { themes: Array<typeof theme1> }) => {
        for (const theme of themes)
          await highlighter.loadTheme(theme)
        return highlighter
      }),
    }))

    try {
      const { disposeHighlighter, registerHighlight } = await import('../packages/stream-markdown/src/utils/highlight.js')
      const { renderCodeWithTokens } = await import('../packages/stream-markdown/src/utils/shiki-render.js')

      const first = registerHighlight({ langs: ['ts'], themes: [theme1 as any] })
      const second = registerHighlight({ langs: ['ts'], themes: [theme2 as any] })

      const hl = await second
      await first

      const html = renderCodeWithTokens(hl as any, 'const a = 1', {
        lang: 'ts',
        theme: 'race-theme',
        tokenCache: false,
        htmlCache: false,
      })

      expect(html).toContain('color: #0000ff;')
      expect(html).not.toContain('color: #ff0000;')

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('keeps future registerHighlight calls usable after a transient theme load failure', async () => {
    vi.resetModules()

    const badTheme = { name: 'retry-theme', color: '#ff0000' }
    const goodTheme = { name: 'retry-theme', color: '#0000ff' }
    let color = ''
    let shouldFail = true

    const highlighter = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{ content: line, color }])
      },
      async loadTheme(theme: typeof badTheme) {
        if (theme === badTheme && shouldFail) {
          shouldFail = false
          throw new Error('transient theme failure')
        }

        color = theme.color
      },
    }

    vi.doMock('shiki', () => ({
      createHighlighter: vi.fn(async () => highlighter),
    }))

    try {
      const { disposeHighlighter, registerHighlight } = await import('../packages/stream-markdown/src/utils/highlight.js')
      const { renderCodeWithTokens } = await import('../packages/stream-markdown/src/utils/shiki-render.js')

      const hl = await registerHighlight({ langs: ['ts'], themes: ['vitesse-dark'] as any })

      await expect(
        registerHighlight({ langs: ['ts'], themes: [badTheme as any] }),
      )
        .rejects
        .toThrow('transient theme failure')

      await registerHighlight({ langs: ['ts'], themes: [goodTheme as any] })

      const html = renderCodeWithTokens(hl as any, 'const a = 1', {
        lang: 'ts',
        theme: 'retry-theme',
        tokenCache: false,
        htmlCache: false,
      })

      expect(html).toContain('color: #0000ff;')

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('does not return a highlighter created before dispose', async () => {
    vi.resetModules()

    let resolveCreate!: (value: any) => void
    const created = new Promise<any>((resolve) => {
      resolveCreate = resolve
    })
    const firstHighlighter = { id: 'first', dispose: vi.fn() }
    const secondHighlighter = { id: 'second' }
    const createHighlighter = vi.fn()
      .mockImplementationOnce(() => created)
      .mockImplementationOnce(async () => secondHighlighter)

    vi.doMock('shiki', () => ({
      createHighlighter,
    }))

    try {
      const { disposeHighlighter, registerHighlight } = await import('../packages/stream-markdown/src/utils/highlight.js')

      const first = registerHighlight({ langs: ['ts'], themes: ['vitesse-dark'] as any })
      for (let i = 0; createHighlighter.mock.calls.length === 0 && i < 10; i++)
        await new Promise(resolve => setTimeout(resolve, 0))

      expect(createHighlighter).toHaveBeenCalledTimes(1)

      disposeHighlighter()
      resolveCreate(firstHighlighter)

      await expect(first).resolves.toBe(secondHighlighter)
      expect(firstHighlighter.dispose).toHaveBeenCalled()
      expect(createHighlighter).toHaveBeenCalledTimes(2)

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('does not let an in-flight load on a disposed highlighter mark future requests as loaded', async () => {
    vi.resetModules()

    let resolveSlowLoadStarted!: () => void
    let resolveSlowLoad!: () => void

    const slowLoadStarted = new Promise<void>((resolve) => {
      resolveSlowLoadStarted = resolve
    })
    const slowLoad = new Promise<void>((resolve) => {
      resolveSlowLoad = resolve
    })

    const firstHighlighter = {
      loadLanguage: vi.fn(async (lang: string) => {
        if (lang === 'slow-lang') {
          resolveSlowLoadStarted()
          await slowLoad
        }
      }),
      loadTheme: vi.fn(async () => {}),
    }
    const secondHighlighter = {
      loadLanguage: vi.fn(async () => {}),
      loadTheme: vi.fn(async () => {}),
    }

    const createHighlighter = vi.fn()
      .mockImplementationOnce(async () => firstHighlighter)
      .mockImplementationOnce(async () => secondHighlighter)

    vi.doMock('shiki', () => ({
      createHighlighter,
    }))

    try {
      const { disposeHighlighter, registerHighlight } = await import('../packages/stream-markdown/src/utils/highlight.js')

      await registerHighlight({ langs: ['ts'], themes: ['vitesse-dark'] as any })

      const inFlight = registerHighlight({
        langs: ['slow-lang'],
        themes: ['vitesse-dark'] as any,
      })

      await slowLoadStarted
      disposeHighlighter()
      resolveSlowLoad()
      await inFlight

      await registerHighlight({
        langs: ['slow-lang'],
        themes: ['vitesse-light'] as any,
      })

      expect(createHighlighter).toHaveBeenCalledTimes(2)
      expect(createHighlighter.mock.calls[1][0].langs).toContain('slow-lang')

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('does not return a disposed highlighter when disposal happens during a pending load', async () => {
    vi.resetModules()

    let resolveSlowLoadStarted!: () => void
    let resolveSlowLoad!: () => void

    const slowLoadStarted = new Promise<void>((resolve) => {
      resolveSlowLoadStarted = resolve
    })
    const slowLoad = new Promise<void>((resolve) => {
      resolveSlowLoad = resolve
    })

    const firstHighlighter = {
      loadLanguage: vi.fn(async (lang: string) => {
        if (lang === 'slow-lang') {
          resolveSlowLoadStarted()
          await slowLoad
        }
      }),
      loadTheme: vi.fn(async () => {}),
    }
    const secondHighlighter = {
      loadLanguage: vi.fn(async () => {}),
      loadTheme: vi.fn(async () => {}),
    }

    const createHighlighter = vi.fn()
      .mockImplementationOnce(async () => firstHighlighter)
      .mockImplementationOnce(async () => secondHighlighter)

    vi.doMock('shiki', () => ({
      createHighlighter,
    }))

    try {
      const { disposeHighlighter, registerHighlight } = await import('../packages/stream-markdown/src/utils/highlight.js')

      await registerHighlight({ langs: ['ts'], themes: ['vitesse-dark'] as any })

      const inFlight = registerHighlight({
        langs: ['slow-lang'],
        themes: ['vitesse-dark'] as any,
      })

      await slowLoadStarted
      disposeHighlighter()
      resolveSlowLoad()

      await expect(inFlight).resolves.toBe(secondHighlighter)
      expect(createHighlighter).toHaveBeenCalledTimes(2)
      expect(createHighlighter.mock.calls[1][0].langs).toContain('slow-lang')

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })
})
