// @vitest-environment jsdom
import { createTokenIncrementalUpdater, updateCodeTokensIncremental } from 'stream-markdown'
import { beforeEach, describe, expect, it } from 'vitest'
import { streamContent as tsMarkdown } from '../src/pages/markdown.js'
import { markdownContent } from '../src/samples/content-markdown.js'
import { phpContent } from '../src/samples/content-php.js'
import { typescriptContent } from '../src/samples/content-typescript.js'
import { verifyCodeLinesStructure } from './verify-lines.js'

// Minimal Highlighter stub using tokens API
const hl = {
  codeToThemedTokens(code: string) {
    // One token per line, no color/style
    return code.split('\n').map(line => [{ content: line }])
  },
}

describe('updateCodeTokensIncremental', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  it('renders full on first call', () => {
    const result = updateCodeTokensIncremental(container, hl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })
    expect(result).toBe('full')
    expect(container.querySelectorAll('code .line').length).toBe(1)
  })

  it('appends a new line incrementally', () => {
    updateCodeTokensIncremental(container, hl as any, 'a', { lang: 'ts', theme: 'vitesse-dark' })
    const res2 = updateCodeTokensIncremental(container, hl as any, 'a\nb', { lang: 'ts', theme: 'vitesse-dark' })
    expect(res2).toBe('incremental')
    const lines = container.querySelectorAll('code .line')
    expect(lines.length).toBe(2)
    expect(lines[0].textContent).toBe('a')
    expect(lines[1].textContent).toBe('b')
  })

  it('updates last line incrementally', () => {
    updateCodeTokensIncremental(container, hl as any, 'abc', { lang: 'ts', theme: 'vitesse-dark' })
    const res2 = updateCodeTokensIncremental(container, hl as any, 'abcd', { lang: 'ts', theme: 'vitesse-dark' })
    expect(res2).toBe('incremental')
    const lines = container.querySelectorAll('code .line')
    expect(lines.length).toBe(1)
    expect(lines[0].textContent).toBe('abcd')
  })

  it('falls back to full when first line changes', () => {
    updateCodeTokensIncremental(container, hl as any, 'x\ny', { lang: 'ts', theme: 'vitesse-dark' })
    const res2 = updateCodeTokensIncremental(container, hl as any, 'z\ny', { lang: 'ts', theme: 'vitesse-dark' })
    expect(res2).toBe('full')
    const lines = container.querySelectorAll('code .line')
    expect(lines.length).toBe(2)
    expect(lines[0].textContent).toBe('z')
    expect(lines[1].textContent).toBe('y')
  })

  it('preserves leading newline as an empty .line', () => {
    const code = '\nimport { createApp } from \'vue\';\nimport App from \'./App.vue\''
    const res = updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    expect(res).toBe('full')
    const lines = container.querySelectorAll('code .line')
    expect(lines.length).toBe(code.split('\n').length)
    expect(lines[0].textContent).toBe('') // first is empty line
    expect(lines[1].textContent).toContain('import { createApp } from \'vue\';')
  })

  it('preserves trailing newline as an empty .line', () => {
    const code = 'a\nb\n'
    updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    const lines = container.querySelectorAll('code .line')
    expect(lines.length).toBe(code.split('\n').length)
    expect(lines[2].textContent).toBe('') // last empty line
  })

  it('preserves multiple consecutive empty lines in the middle', () => {
    const code = 'a\n\n\nb'
    updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    const lines = container.querySelectorAll('code .line')
    expect(lines.length).toBe(4)
    expect(lines[1].textContent).toBe('')
    expect(lines[2].textContent).toBe('')
  })

  it('empty .line count equals empty line count in code', () => {
    const code = '\nA\n\nB\n\n\n'
    updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    const lines = Array.from(container.querySelectorAll('code .line'))
    const emptyDomLines = lines.filter(l => (l.textContent ?? '') === '').length
    const emptyCodeLines = code.split('\n').filter(s => s === '').length
    expect(lines.length).toBe(code.split('\n').length)
    expect(emptyDomLines).toBe(emptyCodeLines)
  })

  it('handles CRLF newlines correctly (\r\n)', () => {
    const code = 'A\r\n\r\nB\r\n'
    updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    const lines = Array.from(container.querySelectorAll('code .line'))
    const normalized = code.replace(/\r\n/g, '\n')
    expect(lines.length).toBe(normalized.split('\n').length)
    // The second line should be empty
    expect(lines[1].textContent).toBe('')
    // Last line (after trailing CRLF) should be empty
    expect(lines[lines.length - 1].textContent).toBe('')
  })

  it('factory updater handles leading newline by full fallback', () => {
    const updater = createTokenIncrementalUpdater(container, hl as any, { lang: 'ts', theme: 'vitesse-dark' })
    const r1 = updater.update('a')
    expect(r1).toBe('full')
    const r2 = updater.update('\na') // leading empty line inserted
    // With the always-diff updater, this can be incremental (update last line to empty, then append)
    expect(['incremental', 'full']).toContain(r2)
    const lines = container.querySelectorAll('code .line')
    expect(lines.length).toBe(2)
    expect(lines[0].textContent).toBe('')
    expect(lines[1].textContent).toBe('a')
  })

  it('uses provided TypeScript markdown content structurally correct', () => {
    const code = tsMarkdown
    const res = updateCodeTokensIncremental(container, hl as any, code, { lang: 'ts', theme: 'vitesse-dark' })
    expect(res).toBe('full')
    const lines = Array.from(container.querySelectorAll('code .line'))
    const normalized = code.replace(/\r\n/g, '\n')
    expect(lines.length).toBe(normalized.split('\n').length)
    // Leading newline should produce empty first line
    expect(lines[0].textContent).toBe('')
    // Middle empty line between imports and createApp call
    const midEmptyIndex = normalized.split('\n').findIndex((s, i) => i > 0 && s === '')
    expect(midEmptyIndex).toBeGreaterThan(0)
    expect(lines[midEmptyIndex].textContent).toBe('')
    // Trailing newline should produce empty last line
    expect(lines[lines.length - 1].textContent).toBe('')
  })

  it('streams char-by-char with updateCodeTokensIncremental and matches final structure', () => {
    const code = tsMarkdown
    const norm = code.replace(/\r\n/g, '\n')
    let acc = ''
    for (const ch of norm) {
      acc += ch
      updateCodeTokensIncremental(container, hl as any, acc, { lang: 'ts', theme: 'vitesse-dark' })
    }

    const res = verifyCodeLinesStructure(container, code)
    expect(res.ok).toBe(true)
    // sanity: first/last should be empty .line
    const lines = Array.from(container.querySelectorAll('code .line'))
    expect(lines[0].textContent).toBe('')
    expect(lines[lines.length - 1].textContent).toBe('')
  })

  it('streamed final output matches Shiki codeToHtml (structure + text)', async () => {
    const { createHighlighter } = await import('shiki')
    const highlighter = await createHighlighter({ themes: ['vitesse-dark'], langs: ['markdown', 'typescript', 'php'] })

    const code = tsMarkdown
    const norm = code.replace(/\r\n/g, '\n')

    let acc = ''
    for (const ch of norm) {
      acc += ch
      updateCodeTokensIncremental(container, highlighter as any, acc, { lang: 'typescript', theme: 'vitesse-dark' })
    }

    // Build expected DOM via Shiki full render
    const html = highlighter.codeToHtml(norm, { lang: 'typescript', theme: 'vitesse-dark' })
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    const codeGot = container.querySelector('code') as HTMLElement
    const codeExp = tmp.querySelector('code') as HTMLElement

    // 1) Same number of .line elements
    const gotLines = codeGot.querySelectorAll('.line')
    const expLines = codeExp.querySelectorAll('.line')
    expect(gotLines.length).toBe(expLines.length)

    // 2) Per-line textContent equality
    for (let i = 0; i < expLines.length; i++) {
      expect(gotLines[i].textContent).toBe(expLines[i].textContent)
    }
  }, 30000)

  it('multi-language streaming matches Shiki per-line text', async () => {
    const { createHighlighter } = await import('shiki')
    const highlighter = await createHighlighter({ themes: ['vitesse-dark'], langs: ['markdown', 'typescript', 'php'] })

    const cases: Array<{ lang: 'markdown' | 'typescript' | 'php', code: string }> = [
      { lang: 'markdown', code: markdownContent },
      { lang: 'typescript', code: typescriptContent },
      { lang: 'php', code: phpContent },
    ]

    for (const { lang, code } of cases) {
      // fresh container per case
      const div = document.createElement('div')
      document.body.appendChild(div)

      const norm = code.replace(/\r\n/g, '\n')
      let acc = ''
      for (const ch of norm) {
        acc += ch
        updateCodeTokensIncremental(div, highlighter as any, acc, { lang, theme: 'vitesse-dark' })
      }

      const html = highlighter.codeToHtml(norm, { lang, theme: 'vitesse-dark' })
      const tmp = document.createElement('div')
      tmp.innerHTML = html

      const codeGot = div.querySelector('code') as HTMLElement
      const codeExp = tmp.querySelector('code') as HTMLElement
      expect(codeGot).toBeTruthy()
      expect(codeExp).toBeTruthy()

      const gotLines = codeGot.querySelectorAll('.line')
      const expLines = codeExp.querySelectorAll('.line')
      expect(gotLines.length).toBe(expLines.length)

      for (let i = 0; i < expLines.length; i++) {
        expect(gotLines[i].textContent).toBe(expLines[i].textContent)
      }

      div.remove()
    }
  }, 60000)
})
