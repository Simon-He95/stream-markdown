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

const maliciousBgHl = {
  codeToThemedTokens(code: string) {
    return code.split('\n').map(line => [{
      content: line,
      color: '#ff0000',
      fontStyle: 0,
    }])
  },
  getTheme() {
    return { bg: '#fff;color:transparent;position:fixed' }
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

  it('uses class token mode with an explicit document styleRoot even without a global document', () => {
    const originalDocument = (globalThis as any).document
    const styleRoot = createDocumentStub()

    try {
      delete (globalThis as any).document

      const html = renderCodeWithTokens(coloredHl as any, 'const a = 1', {
        lang: 'ts',
        theme: 'vitesse-dark',
        styleRoot,
        tokenStyleMode: 'class',
      })

      expect(html).toContain('class="smd-token-')
      expect(html).not.toContain('style="color: #ff0000;')
      expect((styleRoot as any).querySelector('style[data-stream-markdown-token-styles]')?.textContent)
        .toContain('color: #ff0000;')
    }
    finally {
      if (originalDocument === undefined)
        delete (globalThis as any).document
      else
        (globalThis as any).document = originalDocument
    }
  })

  it('keeps an explicit document styleRoot mounted when nodes lack getRootNode', () => {
    const originalDocument = (globalThis as any).document
    const styleRoot = createDocumentStub()

    try {
      delete (globalThis as any).document

      const opts = {
        lang: 'ts',
        theme: 'vitesse-dark',
        styleRoot,
        tokenStyleMode: 'class' as const,
      }

      renderCodeWithTokens(coloredHl as any, 'const a = 1', opts)
      const html = renderCodeWithTokens(coloredHl as any, 'const b = 2', opts)

      expect(html).toContain('class="smd-token-')
      expect((styleRoot as any).querySelector('style[data-stream-markdown-token-styles]')?.textContent)
        .toContain('color: #ff0000;')
    }
    finally {
      if (originalDocument === undefined)
        delete (globalThis as any).document
      else
        (globalThis as any).document = originalDocument
    }
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

  it('does not render stale explicit token lines past the code line count', () => {
    const html = renderCodeWithTokens(coloredHl as any, 'const value = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
      tokenLines: [
        [{ content: 'const value = 1', color: '#ff0000' }],
        [{ content: 'stale line', color: '#0000ff' }],
      ],
    })

    expect(html).toContain('const value = 1')
    expect(html).not.toContain('stale line')
  })

  it('does not reuse cached HTML when theme background changes under the same theme name', () => {
    let bg = '#000000'
    const dynamicBgHl = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{ content: line }])
      },
      getTheme() {
        return { bg }
      },
    }

    const opts = {
      lang: 'ts',
      theme: 'dynamic',
      htmlCache: true,
    }

    const html1 = renderCodeWithTokens(dynamicBgHl as any, 'const a = 1', opts)
    bg = '#ffffff'
    const html2 = renderCodeWithTokens(dynamicBgHl as any, 'const a = 1', opts)

    expect(html1).toContain('background-color: #000000;')
    expect(html2).toContain('background-color: #ffffff;')
  })

  it('does not inject arbitrary CSS from theme background colors', () => {
    const html = renderCodeWithTokens(maliciousBgHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    expect(html).not.toContain('color:transparent')
    expect(html).not.toContain('position:fixed')
  })
})
