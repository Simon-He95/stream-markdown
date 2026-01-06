// @vitest-environment node
import { describe, expect, it } from 'vitest'
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
})
