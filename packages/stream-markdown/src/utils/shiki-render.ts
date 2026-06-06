import type { Highlighter } from 'shiki'
import type { TokenStyleMode } from './token-style.js'
import { getCachedHtml, setCachedHtml } from './html-cache.js'
import { getTokenLines } from './token-cache.js'
import { canUseTokenStyleClasses, ensureTokenStyleSheet, getTokenStyleAttr, normalizeCssColor } from './token-style.js'

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
  tokenStyleMode?: TokenStyleMode
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

function normalizeTokenLinesForCode(
  tokenLines: ThemedToken[][],
  code: string,
  cloneLines = false,
): ThemedToken[][] {
  const expected = countLines(code)
  let lines = cloneLines ? tokenLines.map(line => line.slice()) : tokenLines

  if (lines.length > expected)
    lines = lines.slice(0, expected)
  if (lines.length < expected)
    lines = lines.concat(Array.from({ length: expected - lines.length }, () => []))

  return lines
}

function escapeHtml(str: string): string {
  return str.replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function renderCodeWithTokens(
  highlighter: Highlighter,
  code: string,
  opts: RenderOptions,
): string {
  const { lang, theme, preClass = 'shiki', codeClass = '', lineClass = 'line', showLineNumbers = false, startingLineNumber = 1 } = opts
  const hasExplicitStyleRoot = opts.styleRoot !== undefined
  const requestedTokenStyleMode: TokenStyleMode = opts.tokenStyleMode ?? (hasExplicitStyleRoot ? 'class' : 'inline')
  const tokenStyleMode: TokenStyleMode = requestedTokenStyleMode === 'class' && canUseTokenStyleClasses(opts.styleRoot)
    ? 'class'
    : 'inline'
  let bg: string | undefined
  try {
    const themeObj = (highlighter as any).getTheme?.(theme)
    bg = themeObj?.bg
  }
  catch {
    // ignore
  }
  const safeBg = normalizeCssColor(bg)
  const cacheKey = `${tokenStyleMode}-token-style\u0001${safeBg}\u0001${lang}\u0001${theme}\u0001${preClass}\u0001${codeClass}\u0001${lineClass}\u0001${showLineNumbers ? 1 : 0}\u0001${startingLineNumber}\u0001${code}`
  const canUseHtmlCache = opts.tokenLines == null
  if (canUseHtmlCache) {
    const cachedHtml = getCachedHtml(highlighter, cacheKey, {
      htmlCache: opts.htmlCache,
      htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
    })
    if (cachedHtml) {
      if (tokenStyleMode === 'class')
        ensureTokenStyleSheet(opts.styleRoot)
      return cachedHtml
    }
  }

  const lines = opts.tokenLines
    ? normalizeTokenLinesForCode(opts.tokenLines, code, true)
    : normalizeTokenLinesForCode(getTokenLines(highlighter, code, lang, theme, {
        tokenCache: opts.tokenCache,
        tokenCacheMaxEntries: opts.tokenCacheMaxEntries,
      }), code)

  let lineNumber = startingLineNumber
  const lineHtml = lines.map((line) => {
    const tokensHtml = tokenStyleMode === 'class'
      ? (() => {
          let html = ''
          let i = 0

          while (i < line.length) {
            const t = line[i]
            const styleAttr = getTokenStyleAttr(t.color, t.fontStyle, tokenStyleMode)
            let content = t.content
            i++

            while (i < line.length) {
              const t2 = line[i]
              const styleAttr2 = getTokenStyleAttr(t2.color, t2.fontStyle, tokenStyleMode)
              if (styleAttr2 !== styleAttr)
                break
              content += t2.content
              i++
            }

            html += `<span${styleAttr}>${escapeHtml(content)}</span>`
          }

          return html
        })()
      : line.map((t) => {
          const styleAttr = getTokenStyleAttr(t.color, t.fontStyle, tokenStyleMode)
          return `<span${styleAttr}>${escapeHtml(t.content)}</span>`
        }).join('')

    const ln = showLineNumbers ? `<span class="line-number" data-line="${lineNumber++}"></span>` : ''
    return `<span class="${escapeAttr(lineClass)}">${ln}${tokensHtml}</span>`
  }).join('\n')

  const preStyle = safeBg ? ` style="background-color: ${escapeAttr(safeBg)};"` : ''
  const safePreClass = escapeAttr(preClass)
  const codeCls = codeClass ? ` class="${escapeAttr(codeClass)}"` : ''
  const html = `<pre class="${safePreClass}"${preStyle}><code${codeCls}>${lineHtml}</code></pre>`
  if (tokenStyleMode === 'class')
    ensureTokenStyleSheet(opts.styleRoot)
  if (canUseHtmlCache) {
    setCachedHtml(highlighter, cacheKey, html, {
      htmlCache: opts.htmlCache,
      htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
    })
  }
  return html
}
