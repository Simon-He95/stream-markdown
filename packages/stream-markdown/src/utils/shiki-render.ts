import type { Highlighter } from 'shiki'
import { getCachedHtml, setCachedHtml } from './html-cache.js'
import { getTokenLines } from './token-cache.js'
import { ensureTokenStyleSheet, getTokenStyleAttr } from './token-style.js'

export interface RenderOptions {
  lang: string
  theme: string
  preClass?: string
  codeClass?: string
  lineClass?: string
  showLineNumbers?: boolean
  startingLineNumber?: number
  tokenCache?: boolean
  tokenCacheMaxEntries?: number
  htmlCache?: boolean
  htmlCacheMaxEntries?: number
  tokenLines?: ThemedToken[][]
  styleRoot?: Node | null
}

export interface ThemedToken {
  content: string
  color?: string
  fontStyle?: number
}

function countLines(code: string): number {
  let count = 1
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10)
      count++
  }
  return count
}

function escapeHtml(str: string): string {
  return str.replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function renderCodeWithTokens(
  highlighter: Highlighter,
  code: string,
  opts: RenderOptions,
): string {
  const { lang, theme, preClass = 'shiki', codeClass = '', lineClass = 'line', showLineNumbers = false, startingLineNumber = 1 } = opts
  const tokenStyleMode = typeof document === 'undefined' ? 'inline-token-style' : 'class-token-style'
  const cacheKey = `${tokenStyleMode}\u0001${lang}\u0001${theme}\u0001${preClass}\u0001${codeClass}\u0001${lineClass}\u0001${showLineNumbers ? 1 : 0}\u0001${startingLineNumber}\u0001${code}`
  const canUseHtmlCache = opts.tokenLines == null
  if (canUseHtmlCache) {
    const cachedHtml = getCachedHtml(highlighter, cacheKey, {
      htmlCache: opts.htmlCache,
      htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
    })
    if (cachedHtml) {
      ensureTokenStyleSheet(opts.styleRoot)
      return cachedHtml
    }
  }

  let lines: ThemedToken[][]
  lines = opts.tokenLines
    ? opts.tokenLines.map(line => line.slice())
    : getTokenLines(highlighter, code, lang, theme, {
        tokenCache: opts.tokenCache,
        tokenCacheMaxEntries: opts.tokenCacheMaxEntries,
      })

  {
    const expected = countLines(code)
    if (lines.length < expected) {
      lines = lines.concat(Array.from({ length: expected - lines.length }, () => []))
    }
  }

  let bg: string | undefined
  try {
    const themeObj = (highlighter as any).getTheme?.(theme)
    bg = themeObj?.bg
  }
  catch {
    // ignore
  }

  let lineNumber = startingLineNumber
  const lineHtml = lines.map((line) => {
    const tokensHtml = line.map((t) => {
      const styleAttr = getTokenStyleAttr(t.color, t.fontStyle)
      return `<span${styleAttr}>${escapeHtml(t.content)}</span>`
    }).join('')

    const ln = showLineNumbers ? `<span class="line-number" data-line="${lineNumber++}"></span>` : ''
    return `<span class="${lineClass}">${ln}${tokensHtml}</span>`
  }).join('\n')

  const preStyle = bg ? ` style="background-color: ${bg};"` : ''
  const codeCls = codeClass ? ` class="${codeClass}"` : ''
  const html = `<pre class="${preClass}"${preStyle}><code${codeCls}>${lineHtml}</code></pre>`
  ensureTokenStyleSheet(opts.styleRoot)
  if (canUseHtmlCache) {
    setCachedHtml(highlighter, cacheKey, html, {
      htmlCache: opts.htmlCache,
      htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
    })
  }
  return html
}
