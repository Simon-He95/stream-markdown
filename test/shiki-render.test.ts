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

function createDocumentStub() {
  let styleElement: any = null
  const doc: any = {
    nodeType: 9,
    documentElement: {
      appendChild(element: any) {
        styleElement = element
        element.isConnected = true
      },
    },
    head: {
      appendChild(element: any) {
        styleElement = element
        element.isConnected = true
      },
    },
    querySelector(selector: string) {
      return selector === 'style[data-stream-markdown-token-styles]' ? styleElement : null
    },
    createElement(tag: string) {
      return {
        tagName: tag.toUpperCase(),
        ownerDocument: doc,
        dataset: {},
        style: { color: '' },
        isConnected: false,
        textContent: '',
      }
    },
  }
  return doc as Document
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

  it('does not reuse cached DOM class HTML when rendering without a DOM', () => {
    const originalDocument = (globalThis as any).document
    ;(globalThis as any).document = createDocumentStub()
    const styleRoot = (globalThis as any).document as Document

    try {
      const domHtml = renderCodeWithTokens(coloredHl as any, 'const a = 1', {
        lang: 'ts',
        theme: 'vitesse-dark',
        htmlCache: true,
        styleRoot,
      })

      expect(domHtml).toContain('class="smd-token-')
      expect(domHtml).not.toContain('style="color: #ff0000;')
    }
    finally {
      if (originalDocument === undefined)
        delete (globalThis as any).document
      else
        (globalThis as any).document = originalDocument
    }

    const ssrHtml = renderCodeWithTokens(coloredHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
      htmlCache: true,
    })

    expect(ssrHtml).toContain('style="color: #ff0000;font-style: italic; font-weight: 600;"')
    expect(ssrHtml).not.toContain('class="smd-token-')
  })

  it('does not reuse cached HTML when explicit token lines are provided', () => {
    const opts = {
      lang: 'ts',
      theme: 'vitesse-dark',
      htmlCache: true,
    }

    const redHtml = renderCodeWithTokens(coloredHl as any, 'const value = 1', {
      ...opts,
      tokenLines: [[{ content: 'const value = 1', color: '#ff0000' }]],
    })
    const blueHtml = renderCodeWithTokens(coloredHl as any, 'const value = 1', {
      ...opts,
      tokenLines: [[{ content: 'const value = 1', color: '#0000ff' }]],
    })

    expect(redHtml).toContain('color: #ff0000;')
    expect(blueHtml).toContain('color: #0000ff;')
    expect(blueHtml).not.toBe(redHtml)
  })
})
