import { updateCodeTokensIncremental } from 'stream-markdown'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { streamContent as tsMarkdown } from '../src/pages/markdown.js'
import { verifyCodeLinesStructure } from './verify-lines.js'

// Minimal Highlighter stub using tokens API
const hl = {
  codeToThemedTokens(code: string) {
    return code.split('\n').map(line => [{ content: line }])
  },
}

describe('verifyCodeLinesStructure', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  it('matches leading and trailing empty lines', () => {
    const code = '\nA\nB\n'
    updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    const res = verifyCodeLinesStructure(container, code)
    expect(res.ok).toBe(true)
    expect(res.totalLines).toBe(4)
    expect(res.emptyLines).toBe(2)
    expect(res.totalDomLines).toBe(4)
    expect(res.emptyDomLines).toBe(2)
  })

  it('handles multiple consecutive empty lines', () => {
    const code = 'A\n\n\nB\n\n'
    updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    const res = verifyCodeLinesStructure(container, code)
    expect(res.ok).toBe(true)
    expect(res.emptyDomLines).toBe(4)
  })

  it('handles CRLF newlines', () => {
    const code = 'A\r\n\r\nB\r\n'
    updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    const res = verifyCodeLinesStructure(container, code)
    expect(res.ok).toBe(true)
  })

  it('verifies provided TypeScript markdown content', () => {
    const code = tsMarkdown
    updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    const res = verifyCodeLinesStructure(container, code)
    expect(res.ok).toBe(true)
    // leading and trailing should be empty
    const lines = Array.from(container.querySelectorAll('code .line'))
    expect(lines[0].textContent).toBe('')
    expect(lines[lines.length - 1].textContent).toBe('')
  })
})
