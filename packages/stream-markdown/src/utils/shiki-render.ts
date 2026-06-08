import type { Highlighter } from 'shiki'
import type { TokenStyleMode, TokenStyleModeOption } from './token-style.js'
import { getHighlighterRevision } from './highlighter-revision.js'
import { getCachedHtml, setCachedHtml } from './html-cache.js'
import { getTokenLines } from './token-cache.js'
import { ensureTokenStyleSheet, getTokenStyleAttr, normalizeCssColor, resolveTokenStyleMode } from './token-style.js'

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
  tokenStyleMode?: TokenStyleModeOption
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

function normalizeStartingLineNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return 1
  return Math.trunc(value)
}

function getRenderStyleRoot(opts: RenderOptions): Node | null | undefined {
  if (opts.styleRoot !== undefined)
    return opts.styleRoot
  return typeof document !== 'undefined' ? document : undefined
}

export function renderCodeWithTokens(
  highlighter: Highlighter,
  code: string,
  opts: RenderOptions,
): string {
  const { lang, theme, preClass = 'shiki', codeClass = '', lineClass = 'line', showLineNumbers = false, startingLineNumber: rawStartingLineNumber = 1 } = opts
  const startingLineNumber = normalizeStartingLineNumber(rawStartingLineNumber)
  const styleRoot = getRenderStyleRoot(opts)
  const tokenStyleMode: TokenStyleMode = resolveTokenStyleMode(opts.tokenStyleMode, styleRoot, 'inline')
  let bg: string | undefined
  try {
    const themeObj = (highlighter as any).getTheme?.(theme)
    bg = themeObj?.bg
  }
  catch {
    // ignore
  }
  const safeBg = normalizeCssColor(bg)
  const cacheKey = JSON.stringify([
    'stream-markdown-html-v3',
    getHighlighterRevision(highlighter),
    tokenStyleMode,
    safeBg,
    lang,
    theme,
    preClass,
    codeClass,
    lineClass,
    showLineNumbers,
    startingLineNumber,
    code,
  ])
  const canUseHtmlCache = opts.tokenLines == null
  if (canUseHtmlCache) {
    const cachedHtml = getCachedHtml(highlighter, cacheKey, {
      htmlCache: opts.htmlCache,
      htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
    })
    if (cachedHtml) {
      if (tokenStyleMode === 'class')
        ensureTokenStyleSheet(styleRoot)
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
    ensureTokenStyleSheet(styleRoot)
  if (canUseHtmlCache) {
    setCachedHtml(highlighter, cacheKey, html, {
      htmlCache: opts.htmlCache,
      htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
    })
  }
  return html
}
