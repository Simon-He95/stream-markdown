import type { Highlighter } from 'shiki'
import { getCachedHtml, setCachedHtml } from './html-cache.js'
import { getTokenLines } from './token-cache.js'

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

function fontStyleToCss(style?: number): string {
  if (!style || style === 0)
    return ''
  const parts: string[] = []
  if (style & 1)
    parts.push('font-style: italic;')
  if (style & 2)
    parts.push('font-weight: 600;')
  if (style & 4)
    parts.push('text-decoration: underline; text-underline-offset: 0.15em;')
  return parts.join(' ')
}

const STYLE_CACHE = new Map<string, string>()
function tokenStyle(color?: string, fontStyle?: number): string {
  const key = `${color ?? ''}|${fontStyle ?? 0}`
  const cached = STYLE_CACHE.get(key)
  if (cached !== undefined)
    return cached
  const colorCss = color ? `color: ${color};` : ''
  const style = `${colorCss}${fontStyleToCss(fontStyle)}`
  STYLE_CACHE.set(key, style)
  return style
}

export function renderCodeWithTokens(
  highlighter: Highlighter,
  code: string,
  opts: RenderOptions,
): string {
  const { lang, theme, preClass = 'shiki', codeClass = '', lineClass = 'line', showLineNumbers = false, startingLineNumber = 1 } = opts
  const cacheKey = `${lang}\u0001${theme}\u0001${preClass}\u0001${codeClass}\u0001${lineClass}\u0001${showLineNumbers ? 1 : 0}\u0001${startingLineNumber}\u0001${code}`
  const cachedHtml = getCachedHtml(highlighter, cacheKey, {
    htmlCache: opts.htmlCache,
    htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
  })
  if (cachedHtml)
    return cachedHtml

  let lines: ThemedToken[][]
  lines = getTokenLines(highlighter, code, lang, theme, {
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
      const style = tokenStyle(t.color, t.fontStyle)
      const styleAttr = style ? ` style="${style}"` : ''
      return `<span${styleAttr}>${escapeHtml(t.content)}</span>`
    }).join('')

    const ln = showLineNumbers ? `<span class="line-number" data-line="${lineNumber++}"></span>` : ''
    return `<span class="${lineClass}">${ln}${tokensHtml}</span>`
  }).join('\n')

  const preStyle = bg ? ` style="background-color: ${bg};"` : ''
  const codeCls = codeClass ? ` class="${codeClass}"` : ''
  const html = `<pre class="${preClass}"${preStyle}><code${codeCls}>${lineHtml}</code></pre>`
  setCachedHtml(highlighter, cacheKey, html, {
    htmlCache: opts.htmlCache,
    htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
  })
  return html
}
