import type { Highlighter } from 'shiki'
import type { RenderOptions, ThemedToken } from './shiki-render.js'
import { renderCodeWithTokens } from './shiki-render.js'

export type UpdateResult = 'incremental' | 'full' | 'noop'

function tokensApi(highlighter: Highlighter) {
  const anyHl = highlighter as any
  if (typeof anyHl.codeToThemedTokens === 'function') {
    return (code: string, lang: string, theme: string) => anyHl.codeToThemedTokens(code, lang, theme) as ThemedToken[][]
  }
  if (typeof anyHl.codeToTokens === 'function') {
    return (code: string, lang: string, theme: string) => {
      const r = anyHl.codeToTokens(code, { lang, theme })
      return r.tokens as ThemedToken[][]
    }
  }
  throw new Error('Highlighter does not support token APIs: codeToThemedTokens/codeToTokens')
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

function escapeHtml(str: string): string {
  return str.replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function lineInnerHtml(tokens: ThemedToken[], showLineNumbers: boolean, lineNumber?: number): string {
  const tokensHtml = tokens.map((t) => {
    const color = t.color ? `color: ${t.color};` : ''
    const style = `${color}${fontStyleToCss(t.fontStyle)}`
    const styleAttr = style ? ` style="${style}"` : ''
    return `<span${styleAttr}>${escapeHtml(t.content)}</span>`
  }).join('')
  const ln = showLineNumbers && typeof lineNumber === 'number'
    ? `<span class="line-number" data-line="${lineNumber}"></span>`
    : ''
  return `${ln}${tokensHtml}`
}

export interface TokenIncrementalOptions extends Omit<RenderOptions, 'preClass' | 'codeClass' | 'lineClass'> {
  preClass?: string
  codeClass?: string
  lineClass?: string
  onResult?: (result: UpdateResult) => void
}

export function updateCodeTokensIncremental(
  container: HTMLElement | null | undefined,
  highlighter: Highlighter,
  code: string,
  opts: TokenIncrementalOptions,
): UpdateResult {
  if (!container)
    return 'noop'

  const { lang, theme, preClass = 'shiki', codeClass = '', lineClass = 'line', showLineNumbers = false, startingLineNumber = 1 } = opts
  const tokensFor = tokensApi(highlighter)

  // Ensure initial structure
  const codeEl = container.querySelector('code') as HTMLElement | null
  if (!codeEl) {
    container.innerHTML = renderCodeWithTokens(highlighter, code, { lang, theme, preClass, codeClass, lineClass, showLineNumbers, startingLineNumber })
    opts.onResult?.('full')
    return 'full'
  }

  const oldLines = codeEl.querySelectorAll<HTMLElement>(`.${lineClass}`)
  let tokenLines = tokensFor(code, lang, theme)
  // Normalize to preserve trailing empty lines (e.g., code ending with \n) and handle CRLF
  {
    const expected = code.replace(/\r\n/g, '\n').split('\n').length
    if (tokenLines.length < expected) {
      const pad = expected - tokenLines.length
      tokenLines = tokenLines.concat(Array.from({ length: pad }, () => []))
    }
  }
  const newLen = tokenLines.length
  const oldLen = oldLines.length

  // Find first differing line by comparing innerHTML
  let divergeAt = -1
  const minLen = Math.min(oldLen, newLen)
  let currentLineNumber = startingLineNumber
  for (let idx = 0; idx < minLen; idx++) {
    const newInner = lineInnerHtml(tokenLines[idx], showLineNumbers, showLineNumbers ? currentLineNumber : undefined)
    if (oldLines[idx].innerHTML !== newInner) {
      divergeAt = idx
      break
    }
    currentLineNumber++
  }

  if (divergeAt === -1) {
    // All shared lines match; append any new lines
    if (newLen > oldLen) {
      const frag = document.createDocumentFragment()
      let ln = startingLineNumber + oldLen
      for (let j = oldLen; j < newLen; j++) {
        // Insert a newline separator before each appended line to match Shiki's codeToHtml
        frag.appendChild(document.createTextNode('\n'))
        const span = document.createElement('span')
        span.className = lineClass
        span.innerHTML = lineInnerHtml(tokenLines[j], showLineNumbers, showLineNumbers ? ln : undefined)
        frag.appendChild(span)
        ln++
      }
      codeEl.appendChild(frag)
      opts.onResult?.('incremental')
      return 'incremental'
    }
    opts.onResult?.('noop')
    return 'noop'
  }

  // Divergence at or after last existing line -> update that line and append others
  if (divergeAt >= oldLen - 1) {
    const newInner = lineInnerHtml(tokenLines[divergeAt], showLineNumbers, showLineNumbers ? (startingLineNumber + divergeAt) : undefined)
    oldLines[divergeAt].innerHTML = newInner

    if (newLen > oldLen) {
      const frag = document.createDocumentFragment()
      let ln = startingLineNumber + oldLen
      for (let j = oldLen; j < newLen; j++) {
        // Maintain newline separators between .line spans to match codeToHtml
        frag.appendChild(document.createTextNode('\n'))
        const span = document.createElement('span')
        span.className = lineClass
        span.innerHTML = lineInnerHtml(tokenLines[j], showLineNumbers, showLineNumbers ? ln : undefined)
        frag.appendChild(span)
        ln++
      }
      codeEl.appendChild(frag)
    }
    opts.onResult?.('incremental')
    return 'incremental'
  }

  // Divergence earlier -> full replace for correctness
  container.innerHTML = renderCodeWithTokens(highlighter, code, { lang, theme, preClass, codeClass, lineClass, showLineNumbers, startingLineNumber })
  opts.onResult?.('full')
  return 'full'
}

export interface TokenIncrementalUpdater {
  update: (code: string) => UpdateResult
  reset: () => void
  dispose: () => void
}

export function createTokenIncrementalUpdater(
  container: HTMLElement | null | undefined,
  highlighter: Highlighter,
  opts: TokenIncrementalOptions,
): TokenIncrementalUpdater {
  let alive = true
  let target: HTMLElement | null | undefined = container

  return {
    update: (code: string) => {
      if (!alive)
        return 'noop'
      if (!target)
        return 'noop'
      return updateCodeTokensIncremental(target, highlighter, code, opts)
    },
    reset: () => {
      if (!alive || !target)
        return
      target.innerHTML = ''
    },
    dispose: () => {
      alive = false
      target = null
    },
  }
}
