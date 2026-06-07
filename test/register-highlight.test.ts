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
})
