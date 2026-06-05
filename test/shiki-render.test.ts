// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderCodeWithTokens } from '../packages/stream-markdown/src/utils/shiki-render.js'

const coloredHl = {
  codeToThemedTokens(code: string) {
    return code.split('\n').map(line => [{
      content: line,
      color: '#ff0000',
      fontStyle: 3,
    }])
  },
}

describe('renderCodeWithTokens', () => {
  it('uses inline token styles when rendering without a DOM', () => {
    const html = renderCodeWithTokens(coloredHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    expect(html).toContain('style="color: #ff0000;font-style: italic; font-weight: 600;"')
    expect(html).not.toContain('class="smd-token-')
  })
})
