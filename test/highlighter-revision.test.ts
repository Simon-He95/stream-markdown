// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

describe('highlighter revision', () => {
  it('invalidates updater same-code fast path after same-name theme reload with unchanged background', async () => {
    vi.resetModules()

    const theme1 = { name: 'same-bg-theme', color: '#ff0000', bg: '#101010' }
    const theme2 = { name: 'same-bg-theme', color: '#0000ff', bg: '#101010' }
    let color = ''
    let bg = ''

    const highlighter = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{
          content: line,
          color,
          fontStyle: 0,
        }])
      },
      getTheme() {
        return { bg }
      },
      async loadTheme(theme: typeof theme1) {
        color = theme.color
        bg = theme.bg
      },
      async loadLanguage() {},
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
      const { createTokenIncrementalUpdater } = await import('../packages/stream-markdown/src/utils/incremental-tokens.js')

      const hl = await registerHighlight({ langs: ['ts'], themes: [theme1 as any] })
      const container = document.createElement('div')
      const updater = createTokenIncrementalUpdater(container, hl as any, {
        lang: 'ts',
        theme: 'same-bg-theme',
        tokenStyleMode: 'inline',
      })

      expect(updater.update('const a = 1')).toBe('full')
      expect((container.querySelector('code .line span') as HTMLElement).getAttribute('style'))
        .toContain('color: #ff0000;')

      await registerHighlight({ langs: ['ts'], themes: [theme2 as any] })

      expect(updater.update('const a = 1')).toBe('full')
      expect((container.querySelector('code .line span') as HTMLElement).getAttribute('style'))
        .toContain('color: #0000ff;')

      updater.dispose()
      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('invalidates updater same-code fast path after direct highlighter.loadTheme()', async () => {
    vi.resetModules()

    const theme1 = { name: 'direct-theme', color: '#ff0000', bg: '#101010' }
    const theme2 = { name: 'direct-theme', color: '#0000ff', bg: '#101010' }
    let color = ''
    let bg = ''

    const highlighter = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{
          content: line,
          color,
          fontStyle: 0,
        }])
      },
      getTheme() {
        return { bg }
      },
      async loadTheme(theme: typeof theme1) {
        color = theme.color
        bg = theme.bg
      },
      async loadLanguage() {},
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
      const { createTokenIncrementalUpdater } = await import('../packages/stream-markdown/src/utils/incremental-tokens.js')

      const hl = await registerHighlight({ langs: ['ts'], themes: [theme1 as any] })
      const container = document.createElement('div')
      const updater = createTokenIncrementalUpdater(container, hl as any, {
        lang: 'ts',
        theme: 'direct-theme',
        tokenStyleMode: 'inline',
      })

      expect(updater.update('const a = 1')).toBe('full')
      expect((container.querySelector('code .line span') as HTMLElement).getAttribute('style'))
        .toContain('color: #ff0000;')

      await (hl as any).loadTheme(theme2)

      expect(updater.update('const a = 1')).toBe('full')
      expect((container.querySelector('code .line span') as HTMLElement).getAttribute('style'))
        .toContain('color: #0000ff;')

      updater.dispose()
      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('invalidates updater same-code fast path after rejected direct highlighter.loadTheme()', async () => {
    vi.resetModules()

    const theme1 = { name: 'rejected-direct-theme', color: '#ff0000', bg: '#101010' }
    const theme2 = { name: 'rejected-direct-theme', color: '#0000ff', bg: '#101010' }
    let color = ''
    let bg = ''

    const highlighter = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{
          content: line,
          color,
          fontStyle: 0,
        }])
      },
      getTheme() {
        return { bg }
      },
      async loadTheme(theme: typeof theme1) {
        color = theme.color
        bg = theme.bg

        if (theme === theme2)
          throw new Error('partial theme failure')
      },
      async loadLanguage() {},
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
      const { createTokenIncrementalUpdater } = await import('../packages/stream-markdown/src/utils/incremental-tokens.js')

      const hl = await registerHighlight({ langs: ['ts'], themes: [theme1 as any] })
      const container = document.createElement('div')
      const updater = createTokenIncrementalUpdater(container, hl as any, {
        lang: 'ts',
        theme: 'rejected-direct-theme',
        tokenStyleMode: 'inline',
      })

      expect(updater.update('const a = 1')).toBe('full')
      expect((container.querySelector('code .line span') as HTMLElement).getAttribute('style'))
        .toContain('color: #ff0000;')

      await expect((hl as any).loadTheme(theme2))
        .rejects
        .toThrow('partial theme failure')

      expect(updater.update('const a = 1')).toBe('full')
      expect((container.querySelector('code .line span') as HTMLElement).getAttribute('style'))
        .toContain('color: #0000ff;')

      updater.dispose()
      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })

  it('keeps registerHighlight theme tracking coherent after direct highlighter.loadTheme()', async () => {
    vi.resetModules()

    const theme1 = { name: 'tracked-direct-theme', color: '#ff0000', bg: '#101010' }
    const theme2 = { name: 'tracked-direct-theme', color: '#0000ff', bg: '#101010' }
    let color = ''
    let bg = ''

    const highlighter = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{
          content: line,
          color,
          fontStyle: 0,
        }])
      },
      getTheme() {
        return { bg }
      },
      async loadTheme(theme: typeof theme1) {
        color = theme.color
        bg = theme.bg
      },
      async loadLanguage() {},
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

      expect(renderCodeWithTokens(hl as any, 'x', {
        lang: 'ts',
        theme: 'tracked-direct-theme',
        tokenStyleMode: 'inline',
      })).toContain('color: #ff0000;')

      await (hl as any).loadTheme(theme2)

      expect(renderCodeWithTokens(hl as any, 'x', {
        lang: 'ts',
        theme: 'tracked-direct-theme',
        tokenStyleMode: 'inline',
      })).toContain('color: #0000ff;')

      await registerHighlight({ langs: ['ts'], themes: [theme1 as any] })

      expect(renderCodeWithTokens(hl as any, 'x', {
        lang: 'ts',
        theme: 'tracked-direct-theme',
        tokenStyleMode: 'inline',
      })).toContain('color: #ff0000;')

      disposeHighlighter()
    }
    finally {
      vi.doUnmock('shiki')
      vi.resetModules()
    }
  })
})
