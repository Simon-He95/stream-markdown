// @vitest-environment jsdom
import { createTokenIncrementalUpdater, renderCodeWithTokens, updateCodeTokensIncremental } from 'stream-markdown'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeCssColor } from '../packages/stream-markdown/src/utils/token-style.js'
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

const coloredHl = {
  codeToThemedTokens(code: string) {
    return code.split('\n').map(line => [{
      content: line,
      color: '#ff0000',
      fontStyle: 3,
    }])
  },
}

const themedHl = {
  codeToThemedTokens(code: string) {
    return code.split('\n').map(line => [{
      content: line,
      color: '#ff0000',
    }])
  },
  getTheme(theme: string) {
    return { bg: theme === 'dark' ? '#000000' : '#ffffff' }
  },
}

const maliciousColorHl = {
  codeToThemedTokens(code: string) {
    return code.split('\n').map(line => [{
      content: line,
      color: '#ff0000;}body{display:none',
      fontStyle: 0,
    }])
  },
}

describe('updateCodeTokensIncremental', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.head.innerHTML = ''
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

  it('falls back to full render for existing untracked DOM', () => {
    container.innerHTML = [
      '<pre class="old-pre">',
      '<code class="old-code">',
      '<span class="old-line"><span>a</span></span>',
      '</code>',
      '</pre>',
    ].join('')

    const result = updateCodeTokensIncremental(container, hl as any, 'a\nb', {
      lang: 'ts',
      theme: 'vitesse-dark',
      preClass: 'new-pre',
      codeClass: 'new-code',
      lineClass: 'new-line',
    })

    expect(result).toBe('full')
    expect(container.querySelector('pre')?.className).toBe('new-pre')
    expect(container.querySelector('code')?.className).toBe('new-code')
    expect(container.querySelectorAll('code .old-line')).toHaveLength(0)
    expect(container.querySelectorAll('code .new-line')).toHaveLength(2)
    expect(container.querySelector('code')?.textContent).toBe('a\nb')
  })

  it('unobserves scheduled containers after the task runs', async () => {
    vi.resetModules()

    const origGlobalIO = (globalThis as any).IntersectionObserver
    const origWindowIO = (window as any).IntersectionObserver
    const origRic = (window as any).requestIdleCallback
    const observe = vi.fn()
    const unobserve = vi.fn()

    class MockIntersectionObserver {
      observe = observe
      unobserve = unobserve
    }

    ;(globalThis as any).IntersectionObserver = MockIntersectionObserver
    ;(window as any).IntersectionObserver = MockIntersectionObserver
    ;(window as any).requestIdleCallback = (cb: IdleRequestCallback) => {
      return window.setTimeout(() => cb({ timeRemaining: () => 999, didTimeout: true }), 0)
    }

    try {
      const { createScheduledTokenIncrementalUpdater } = await import('../packages/stream-markdown/src/utils/incremental-tokens.js')
      const updater = createScheduledTokenIncrementalUpdater(container, hl as any, {
        lang: 'ts',
        theme: 'vitesse-dark',
        throttleMs: 0,
      })

      updater.update('scheduled')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(observe).toHaveBeenCalledWith(container)
      expect(unobserve).toHaveBeenCalledWith(container)
      updater.dispose()
    }
    finally {
      if (origGlobalIO === undefined)
        delete (globalThis as any).IntersectionObserver
      else
        (globalThis as any).IntersectionObserver = origGlobalIO

      if (origWindowIO === undefined)
        delete (window as any).IntersectionObserver
      else
        (window as any).IntersectionObserver = origWindowIO

      if (origRic === undefined)
        delete (window as any).requestIdleCallback
      else
        (window as any).requestIdleCallback = origRic

      vi.resetModules()
    }
  })

  it('renders token styles with classes instead of inline styles', () => {
    updateCodeTokensIncremental(container, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    const token = container.querySelector('code .line span') as HTMLElement
    expect(token.getAttribute('style')).toBeNull()
    expect(token.className).toMatch(/^smd-token-/)
    const style = document.head.querySelector('style[data-stream-markdown-token-styles]')?.textContent
    expect(style).toContain(`.${token.className}`)
    expect(style).toContain('color: #ff0000;')
    expect(style).toContain('font-style: italic;')
    expect(style).toContain('font-weight: 600;')
  })

  it('allows inline token styles in incremental rendering when requested', () => {
    updateCodeTokensIncremental(container, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
      tokenStyleMode: 'inline',
    })

    const token = container.querySelector('code .line span') as HTMLElement
    expect(token.className).toBe('')
    expect(token.getAttribute('style')).toContain('color: #ff0000;')
    expect(token.getAttribute('style')).toContain('font-style: italic;')
    expect(token.getAttribute('style')).toContain('font-weight: 600;')
    expect(document.head.querySelector('style[data-stream-markdown-token-styles]')).toBeNull()
  })

  it('forces a full render when incremental tokenStyleMode changes', () => {
    updateCodeTokensIncremental(container, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    expect((container.querySelector('code .line span') as HTMLElement).className).toMatch(/^smd-token-/)

    const result = updateCodeTokensIncremental(container, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
      tokenStyleMode: 'inline',
    })

    expect(result).toBe('full')
    const token = container.querySelector('code .line span') as HTMLElement
    expect(token.className).toBe('')
    expect(token.getAttribute('style')).toContain('color: #ff0000;')
  })

  it('generates deterministic token class names independent of allocation order', async () => {
    vi.resetModules()
    const first = await import('../packages/stream-markdown/src/utils/token-style.js')
    const redFirst = first.getTokenClassName('#ff0000', 0)
    const blueFirst = first.getTokenClassName('#0000ff', 0)

    vi.resetModules()
    const second = await import('../packages/stream-markdown/src/utils/token-style.js')
    const blueSecond = second.getTokenClassName('#0000ff', 0)
    const redSecond = second.getTokenClassName('#ff0000', 0)

    expect(redSecond).toBe(redFirst)
    expect(blueSecond).toBe(blueFirst)
    expect(redFirst).not.toBe(blueFirst)
  })

  it('does not overwrite an existing token style element from another bundle instance', () => {
    const foreignStyle = document.createElement('style')
    foreignStyle.dataset.streamMarkdownTokenStyles = ''
    foreignStyle.textContent = '.foreign-token{color: blue;}'
    document.head.appendChild(foreignStyle)

    updateCodeTokensIncremental(container, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    const styleEls = Array.from(
      document.head.querySelectorAll('style[data-stream-markdown-token-styles]'),
    )
    const ownStyle = styleEls.find(el => el !== foreignStyle)

    expect(styleEls).toHaveLength(2)
    expect(foreignStyle.textContent).toBe('.foreign-token{color: blue;}')
    expect(ownStyle?.textContent).toContain('color: #ff0000;')
  })

  it('rehydrates token style rules when cached HTML is reused', () => {
    const opts = {
      lang: 'ts',
      theme: 'vitesse-dark',
      htmlCache: true,
      styleRoot: document,
    }

    const html1 = renderCodeWithTokens(coloredHl as any, 'const a = 1', opts)

    expect(html1).toContain('class="smd-token-')
    expect(html1).not.toContain('style="color: #ff0000;')

    let styleEl = document.head.querySelector('style[data-stream-markdown-token-styles]')
    expect(styleEl?.textContent).toContain('color: #ff0000;')

    document.head.innerHTML = ''

    const html2 = renderCodeWithTokens(coloredHl as any, 'const a = 1', opts)

    expect(html2).toBe(html1)
    styleEl = document.head.querySelector('style[data-stream-markdown-token-styles]')
    expect(styleEl?.textContent).toContain('color: #ff0000;')
  })

  it('repairs a mounted token style element whose text was externally cleared', () => {
    updateCodeTokensIncremental(container, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    const styleEl = document.head.querySelector('style[data-stream-markdown-token-styles]') as HTMLStyleElement
    expect(styleEl.textContent).toContain('color: #ff0000;')

    styleEl.textContent = ''

    updateCodeTokensIncremental(container, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    expect(styleEl.textContent).toContain('color: #ff0000;')
  })

  it('keeps renderCodeWithTokens self-contained by default in a DOM environment', () => {
    const html = renderCodeWithTokens(coloredHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    expect(html).toContain('style="color: #ff0000;font-style: italic; font-weight: 600;"')
    expect(html).not.toContain('class="smd-token-')
  })

  it('does not switch to class token mode when styleRoot is explicitly undefined', () => {
    const html = renderCodeWithTokens(coloredHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
      styleRoot: undefined,
    })

    expect(html).toContain('style="color: #ff0000;font-style: italic; font-weight: 600;"')
    expect(html).not.toContain('class="smd-token-')
  })

  it('falls back to inline token styles when styleRoot is explicitly null', () => {
    const html = renderCodeWithTokens(coloredHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
      styleRoot: null,
    })

    expect(html).toContain('style="color: #ff0000;font-style: italic; font-weight: 600;"')
    expect(html).not.toContain('class="smd-token-')
    expect(document.head.querySelector('style[data-stream-markdown-token-styles]')).toBeNull()
  })

  it('rehydrates token style rules when an updater skips identical code', () => {
    const updater = createTokenIncrementalUpdater(container, coloredHl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    updater.update('const')
    expect(document.head.querySelector('style[data-stream-markdown-token-styles]')?.textContent)
      .toContain('color: #ff0000;')

    document.head.innerHTML = ''

    expect(updater.update('const')).toBe('noop')
    expect(document.head.querySelector('style[data-stream-markdown-token-styles]')?.textContent)
      .toContain('color: #ff0000;')

    updater.dispose()
  })

  it('does not inject arbitrary global CSS from token colors', () => {
    updateCodeTokensIncremental(container, maliciousColorHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    expect(document.head.textContent ?? '').not.toContain('body{display:none')
    expect(document.head.textContent ?? '').not.toContain('}body{')
  })

  it('escapes public class-name options in generated HTML', () => {
    const html = renderCodeWithTokens(coloredHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'vitesse-dark',
      preClass: 'shiki"<x> data-bad="1',
      codeClass: 'code"<x> data-bad="1',
      lineClass: 'line"<x> data-bad="1',
    })

    expect(html).toContain('class="shiki&quot;&lt;x&gt; data-bad=&quot;1"')
    expect(html).toContain('class="code&quot;&lt;x&gt; data-bad=&quot;1"')
    expect(html).toContain('class="line&quot;&lt;x&gt; data-bad=&quot;1"')
    expect(html).not.toContain('data-bad="1"')
  })

  it('keeps sanitized CSS custom-property colors', () => {
    expect(normalizeCssColor('var(--smd-token-color, #ff0000)'))
      .toBe('var(--smd-token-color, #ff0000)')
    expect(normalizeCssColor('var(--smd-token-color, url(https://x.test/a))'))
      .toBe('')
  })

  it('normalizes token colors without depending on runtime CSS.supports', () => {
    const originalCSS = (globalThis as any).CSS
    ;(globalThis as any).CSS = {
      supports: () => false,
    }

    try {
      expect(normalizeCssColor('color-mix(in srgb, red, blue)'))
        .toBe('color-mix(in srgb, red, blue)')
      expect(normalizeCssColor('color-mix(in srgb, #ff0000 50%, #0000ff)'))
        .toBe('color-mix(in srgb, #ff0000 50%, #0000ff)')
      expect(normalizeCssColor('light-dark(#fff, #000)'))
        .toBe('light-dark(#fff, #000)')
      expect(normalizeCssColor('color-mix(in srgb, var(--smd-token-color), #ffffff)'))
        .toBe('color-mix(in srgb, var(--smd-token-color), #ffffff)')
      expect(normalizeCssColor('rgb(from var(--smd-token-color) r g b / 50%)'))
        .toBe('rgb(from var(--smd-token-color) r g b / 50%)')
      expect(normalizeCssColor('rgb(expression(alert()))'))
        .toBe('')
      expect(normalizeCssColor('#ff0000;}body{display:none'))
        .toBe('')
      expect(normalizeCssColor('rgb(255, 0, 0)'))
        .toBe('rgb(255, 0, 0)')
      expect(normalizeCssColor('#123'))
        .toBe('#123')
      expect(normalizeCssColor('#1234'))
        .toBe('#1234')
      expect(normalizeCssColor('#123456'))
        .toBe('#123456')
      expect(normalizeCssColor('#12345678'))
        .toBe('#12345678')
      expect(normalizeCssColor('#12345'))
        .toBe('')
      expect(normalizeCssColor('#1234567'))
        .toBe('')
    }
    finally {
      if (originalCSS === undefined) {
        delete (globalThis as any).CSS
      }
      else {
        ;(globalThis as any).CSS = originalCSS
      }
    }
  })

  it('injects generated token styles into the container shadow root', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const shadowContainer = document.createElement('div')
    shadow.appendChild(shadowContainer)

    updateCodeTokensIncremental(shadowContainer, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    const token = shadowContainer.querySelector('code .line span') as HTMLElement
    expect(token.className).toMatch(/^smd-token-/)

    const shadowStyle = shadow.querySelector('style[data-stream-markdown-token-styles]')?.textContent
    expect(shadowStyle).toContain(`.${token.className}`)
    expect(shadowStyle).toContain('color: #ff0000;')

    expect(document.head.querySelector('style[data-stream-markdown-token-styles]')).toBeNull()
  })

  it('falls back to inline token styles when styleRoot is null inside shadow DOM', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const shadowContainer = document.createElement('div')
    shadow.appendChild(shadowContainer)

    updateCodeTokensIncremental(shadowContainer, coloredHl as any, 'const', {
      lang: 'ts',
      theme: 'vitesse-dark',
      styleRoot: null,
    })

    const token = shadowContainer.querySelector('code .line span') as HTMLElement
    expect(token.className).toBe('')
    expect(token.getAttribute('style')).toContain('color: #ff0000;')

    expect(shadow.querySelector('style[data-stream-markdown-token-styles]')).toBeNull()
    expect(document.head.querySelector('style[data-stream-markdown-token-styles]')).toBeNull()
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

  it('does not let reentrant onResult leave stale append-only state', () => {
    let reentered = false
    const updaterRef = {} as { current: ReturnType<typeof createTokenIncrementalUpdater> }

    const updater = createTokenIncrementalUpdater(container, hl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      appendOnlyFastPath: true,
      onResult: () => {
        if (reentered)
          return

        reentered = true
        updaterRef.current.update('x\nb')
      },
    })
    updaterRef.current = updater

    updater.update('a\nb')

    expect(container.querySelector('code')?.textContent).toBe('x\nb')

    updater.update('a\nbc')

    expect(container.querySelector('code')?.textContent).toBe('a\nbc')
    updater.dispose()
  })

  it('keeps direct updater same-code state when onResult throws', () => {
    let tokenizationCount = 0
    const countedHl = {
      codeToThemedTokens(code: string) {
        tokenizationCount++
        return code.split('\n').map(line => [{
          content: line,
          color: '#ff0000',
          fontStyle: 0,
        }])
      },
    }

    const updater = createTokenIncrementalUpdater(container, countedHl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      onResult: () => {
        throw new Error('consumer failed')
      },
    })

    expect(() => updater.update('same')).toThrow('consumer failed')
    expect(container.querySelector('code')?.textContent).toBe('same')
    expect(tokenizationCount).toBe(1)

    expect(() => updater.update('same')).toThrow('consumer failed')
    expect(tokenizationCount).toBe(1)

    updater.dispose()
  })

  it('keeps skip-same fast path state after reentrant updater updates', () => {
    let tokenizationCount = 0
    const countedHl = {
      codeToThemedTokens(code: string) {
        tokenizationCount++
        return code.split('\n').map(line => [{
          content: line,
          color: '#ff0000',
          fontStyle: 0,
        }])
      },
    }

    let reentered = false
    const updaterRef = {} as { current: ReturnType<typeof createTokenIncrementalUpdater> }

    const updater = createTokenIncrementalUpdater(container, countedHl as any, {
      lang: 'ts',
      theme: 'vitesse-dark',
      onResult: () => {
        if (reentered)
          return

        reentered = true
        updaterRef.current.update('inner')
      },
    })
    updaterRef.current = updater

    updater.update('outer')
    expect(container.querySelector('code')?.textContent).toBe('inner')
    expect(tokenizationCount).toBe(2)

    expect(updater.update('inner')).toBe('noop')
    expect(tokenizationCount).toBe(2)

    updater.dispose()
  })

  it('removes stale trailing lines when code shrinks with matching prefix lines', () => {
    updateCodeTokensIncremental(container, hl as any, 'a\nb\nc', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    const res2 = updateCodeTokensIncremental(container, hl as any, 'a\nb', {
      lang: 'ts',
      theme: 'vitesse-dark',
    })

    expect(res2).toBe('full')

    const lines = container.querySelectorAll('code .line')
    expect(lines.length).toBe(2)
    expect(lines[0].textContent).toBe('a')
    expect(lines[1].textContent).toBe('b')
  })

  it('removes stale trailing lines from explicit token lines when code shrinks', () => {
    updateCodeTokensIncremental(container, hl as any, 'a\nb\nc', {
      lang: 'ts',
      theme: 'vitesse-dark',
      tokenLines: [
        [{ content: 'a' }],
        [{ content: 'b' }],
        [{ content: 'c' }],
      ],
    })

    const result = updateCodeTokensIncremental(container, hl as any, 'a\nb', {
      lang: 'ts',
      theme: 'vitesse-dark',
      tokenLines: [
        [{ content: 'a' }],
        [{ content: 'b' }],
        [{ content: 'stale' }],
      ],
    })

    expect(result).toBe('full')

    const lines = container.querySelectorAll('code .line')
    expect(lines).toHaveLength(2)
    expect(container.querySelector('code')?.textContent).toBe('a\nb')
    expect(container.querySelector('code')?.textContent).not.toContain('stale')
  })

  it('forces a full render when render options change', () => {
    updateCodeTokensIncremental(container, themedHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'dark',
    })

    expect(container.querySelector('pre')?.getAttribute('style')).toContain('#000000')

    const result = updateCodeTokensIncremental(container, themedHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'light',
      preClass: 'next-pre',
      codeClass: 'next-code',
      lineClass: 'next-line',
    })

    expect(result).toBe('full')
    expect(container.querySelector('pre')?.getAttribute('style')).toContain('#ffffff')
    expect(container.querySelector('pre')?.className).toBe('next-pre')
    expect(container.querySelector('code')?.className).toBe('next-code')
    expect(container.querySelectorAll('code .next-line')).toHaveLength(1)
  })

  it('forces a full render when the same theme name resolves to a different background', () => {
    let bg = '#000000'
    const dynamicBgHl = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{
          content: line,
          color: '#ff0000',
        }])
      },
      getTheme() {
        return { bg }
      },
    }

    updateCodeTokensIncremental(container, dynamicBgHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'dynamic',
    })
    expect(container.querySelector('pre')?.getAttribute('style')).toContain('#000000')

    bg = '#ffffff'
    const result = updateCodeTokensIncremental(container, dynamicBgHl as any, 'const a = 1', {
      lang: 'ts',
      theme: 'dynamic',
    })

    expect(result).toBe('full')
    expect(container.querySelector('pre')?.getAttribute('style')).toContain('#ffffff')
  })

  it('does not skip identical code when the same theme name resolves to a different background', () => {
    let bg = '#000000'
    const dynamicBgHl = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [{
          content: line,
          color: '#ff0000',
        }])
      },
      getTheme() {
        return { bg }
      },
    }
    const updater = createTokenIncrementalUpdater(container, dynamicBgHl as any, {
      lang: 'ts',
      theme: 'dynamic',
    })

    updater.update('const a = 1')
    expect(container.querySelector('pre')?.getAttribute('style')).toContain('#000000')

    bg = '#ffffff'
    expect(updater.update('const a = 1')).toBe('full')
    expect(container.querySelector('pre')?.getAttribute('style')).toContain('#ffffff')

    updater.dispose()
  })

  it('does not falsely diverge in innerHTML mode after merged token DOM is created', () => {
    const splitSameStyleHl = {
      codeToThemedTokens(code: string) {
        return code.split('\n').map(line => [
          { content: line.slice(0, 1), color: '#ff0000', fontStyle: 0 },
          { content: line.slice(1), color: '#ff0000', fontStyle: 0 },
        ])
      },
    }

    updateCodeTokensIncremental(container, splitSameStyleHl as any, 'ab', {
      lang: 'ts',
      theme: 'vitesse-dark',
      compareMode: 'innerHTML',
    })

    expect(updateCodeTokensIncremental(container, splitSameStyleHl as any, 'ab', {
      lang: 'ts',
      theme: 'vitesse-dark',
      compareMode: 'innerHTML',
    })).toBe('noop')

    updateCodeTokensIncremental(container, splitSameStyleHl as any, 'abc', {
      lang: 'ts',
      theme: 'vitesse-dark',
      compareMode: 'innerHTML',
    })

    const before = container.querySelector('code .line')!.innerHTML

    const res = updateCodeTokensIncremental(container, splitSameStyleHl as any, 'abc', {
      lang: 'ts',
      theme: 'vitesse-dark',
      compareMode: 'innerHTML',
    })

    expect(res).toBe('noop')
    expect(container.querySelector('code .line')!.innerHTML).toBe(before)
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
