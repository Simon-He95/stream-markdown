import type { Highlighter } from 'shiki'
import type { RenderOptions, ThemedToken } from './shiki-render.js'
import type { TokenStyleMode, TokenStyleModeOption } from './token-style.js'
import { getHighlighterRevision } from './highlighter-revision.js'
import { renderCodeWithTokens } from './shiki-render.js'
import { getTokenLines } from './token-cache.js'
import {
  applyTokenStyleToElement,
  ensureTokenStyleSheet,
  getTokenStyleAttr,
  getTokenStyleSignature,
  normalizeCssColor,
  resolveTokenStyleMode,
} from './token-style.js'

export type UpdateResult = 'incremental' | 'full' | 'noop'

const RENDER_SIGNATURES = new WeakMap<HTMLElement, string>()
const LINE_SIGNATURES = new WeakMap<HTMLElement, string>()
const LINE_DOM_HTML = new WeakMap<HTMLElement, string>()
const LAST_CODE = new WeakMap<HTMLElement, string>()
const CODE_DOM_HTML = new WeakMap<HTMLElement, string>()

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

function cloneTokenLines(tokenLines: ThemedToken[][] | undefined): ThemedToken[][] | undefined {
  return tokenLines?.map(line => line.map(token => ({ ...token })))
}

function normalizeStartingLineNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return 1
  return Math.trunc(value)
}

function estimateNodeCost(code: string): number {
  const lineCount = countLines(code)
  const estTokenSpans = Math.ceil(code.length / 6)
  return Math.min(8000, lineCount + estTokenSpans)
}

function normalizeDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return 0
  return value
}

function getIdleTimeRemaining(deadline: any, fallback = 50): number {
  if (typeof deadline?.timeRemaining !== 'function')
    return fallback

  const value = deadline.timeRemaining()
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function normalizeRenderedContent(str: string): string {
  return str.replace(/\r/g, '')
}

function escapeHtml(str: string): string {
  return normalizeRenderedContent(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderSignature(options: {
  lang: string
  theme: string
  backgroundColor: string
  highlighterRevision: number
  tokenStyleMode: TokenStyleMode
  preClass: string
  codeClass: string
  lineClass: string
  showLineNumbers: boolean
  startingLineNumber: number
}): string {
  return JSON.stringify([
    options.lang,
    options.theme,
    options.backgroundColor,
    options.highlighterRevision,
    options.tokenStyleMode,
    options.preClass,
    options.codeClass,
    options.lineClass,
    options.showLineNumbers,
    options.startingLineNumber,
  ])
}

function getThemeBackgroundColor(highlighter: Highlighter, theme: string): string {
  try {
    const themeObj = (highlighter as any).getTheme?.(theme)
    return normalizeCssColor(themeObj?.bg)
  }
  catch {
    return ''
  }
}

function getClassAttribute(el: Element): string {
  return el.getAttribute('class') ?? ''
}

function expectedPreStyle(backgroundColor: string): string {
  return backgroundColor ? `background-color: ${backgroundColor};` : ''
}

function normalizeInlineStyle(ownerDocument: Document, styleText: string): string {
  if (!styleText)
    return ''

  const el = ownerDocument.createElement('pre')
  el.setAttribute('style', styleText)
  return el.style.cssText.trim()
}

function hasExpectedPreStyle(preEl: HTMLElement, backgroundColor: string): boolean {
  const actual = preEl.getAttribute('style') ?? ''
  const expected = expectedPreStyle(backgroundColor)

  if (actual === expected)
    return true

  return normalizeInlineStyle(preEl.ownerDocument, actual) === normalizeInlineStyle(preEl.ownerDocument, expected)
}

function hasExpectedRenderedShell(
  container: HTMLElement,
  codeEl: HTMLElement,
  options: {
    preClass: string
    codeClass: string
    backgroundColor: string
  },
): boolean {
  const preEl = codeEl.parentElement

  return !!preEl
    && preEl.tagName.toLowerCase() === 'pre'
    && preEl.parentElement === container
    && container.childNodes.length === 1
    && container.firstChild === preEl
    && preEl.childNodes.length === 1
    && preEl.firstChild === codeEl
    && getClassAttribute(preEl) === options.preClass
    && getClassAttribute(codeEl) === options.codeClass
    && hasExpectedPreStyle(preEl, options.backgroundColor)
}

function clearContainerRenderState(container: HTMLElement): void {
  LAST_CODE.delete(container)
  RENDER_SIGNATURES.delete(container)
  CODE_DOM_HTML.delete(container)
}

function setContainerRenderState(container: HTMLElement, code: string, signature: string): void {
  LAST_CODE.set(container, code)
  RENDER_SIGNATURES.set(container, signature)

  const codeEl = container.querySelector('code') as HTMLElement | null
  if (codeEl)
    CODE_DOM_HTML.set(container, codeEl.innerHTML)
  else
    CODE_DOM_HTML.delete(container)
}

function rememberLineSignature(line: HTMLElement, signature: string): void {
  LINE_SIGNATURES.set(line, signature)
  LINE_DOM_HTML.set(line, line.innerHTML)
}

function getTrustedLineSignature(line: HTMLElement): string | undefined {
  const signature = LINE_SIGNATURES.get(line)
  if (!signature)
    return undefined

  if (LINE_DOM_HTML.get(line) !== line.innerHTML) {
    LINE_SIGNATURES.delete(line)
    LINE_DOM_HTML.delete(line)
    return undefined
  }

  return signature
}

function hasUnchangedRenderedCodeDom(container: HTMLElement, codeEl: Element): boolean {
  return CODE_DOM_HTML.get(container) === (codeEl as HTMLElement).innerHTML
}

function getIncrementalStyleRoot(opts: { styleRoot?: Node | null }, container: HTMLElement): Node | null {
  return opts.styleRoot === undefined ? container : opts.styleRoot
}

function resolveIncrementalTokenStyleMode(
  opts: { tokenStyleMode?: TokenStyleModeOption },
  styleRoot: Node | null,
): TokenStyleMode {
  return resolveTokenStyleMode(opts.tokenStyleMode, styleRoot, 'class')
}

function ensureIncrementalTokenStyleSheet(styleRoot: Node | null, tokenStyleMode: TokenStyleMode): void {
  if (tokenStyleMode === 'class')
    ensureTokenStyleSheet(styleRoot)
}

function splitClassNames(className: string): string[] {
  return className.trim().split(/\s+/).filter(Boolean)
}

function getCodeLineElements(codeEl: HTMLElement, lineClass: string): HTMLElement[] {
  const lines = Array.from(codeEl.children) as HTMLElement[]
  const classNames = splitClassNames(lineClass)

  // `lineClass: ''` is a valid public option. In that case, the rendered line
  // nodes are still the direct children of <code>, but getElementsByClassName('')
  // cannot identify them and causes stale/duplicated lines during incremental updates.
  if (classNames.length === 0)
    return lines

  // Only direct <code> children are rendered lines. Nested `.line-number` spans
  // or token spans must not be counted as lines even if class names collide.
  return lines.filter(el => classNames.every(className => el.classList.contains(className)))
}

function previousCodeLines(code: string): string[] {
  return normalizeRenderedContent(code).split('\n')
}

function hasExpectedLineElementShell(line: HTMLElement, lineClass: string): boolean {
  return line.tagName.toLowerCase() === 'span'
    && getClassAttribute(line) === lineClass
}

function hasExpectedCodeLineChildNodes(
  codeEl: HTMLElement,
  oldLines: HTMLElement[],
): boolean {
  if (oldLines.length === 0)
    return codeEl.childNodes.length === 0

  if (codeEl.childNodes.length !== oldLines.length * 2 - 1)
    return false

  for (let i = 0; i < oldLines.length; i++) {
    const lineNodeIndex = i * 2
    if (codeEl.childNodes[lineNodeIndex] !== oldLines[i])
      return false

    if (i < oldLines.length - 1) {
      const separator = codeEl.childNodes[lineNodeIndex + 1]
      if (!separator || separator.nodeType !== 3 || separator.textContent !== '\n')
        return false
    }
  }

  return true
}

function hasExpectedCodeLineStructure(
  codeEl: HTMLElement,
  oldLines: HTMLElement[],
  prevCode: string,
  lineClass: string,
): boolean {
  const expectedLines = previousCodeLines(prevCode)

  // External DOM mutations can preserve textContent while replacing/removing
  // wrappers; incremental updates would otherwise leave stale direct children.
  if (oldLines.length !== codeEl.children.length)
    return false
  if (oldLines.length !== expectedLines.length)
    return false
  if (!hasExpectedCodeLineChildNodes(codeEl, oldLines))
    return false

  for (let i = 0; i < oldLines.length; i++) {
    const oldLine = oldLines[i]

    if (!hasExpectedLineElementShell(oldLine, lineClass))
      return false
    if ((oldLine.textContent ?? '').replace(/\r/g, '') !== expectedLines[i])
      return false
  }

  return true
}

function lineInnerHtml(
  tokens: ThemedToken[],
  showLineNumbers: boolean,
  lineNumber: number | undefined,
  tokenStyleMode: TokenStyleMode,
): string {
  let tokensHtml = ''

  if (tokenStyleMode === 'inline') {
    for (const t of tokens) {
      const styleAttr = getTokenStyleAttr(t.color, t.fontStyle, tokenStyleMode)
      tokensHtml += `<span${styleAttr}>${escapeHtml(t.content)}</span>`
    }
  }
  else {
    let i = 0

    while (i < tokens.length) {
      const t = tokens[i]
      const styleAttr = getTokenStyleAttr(t.color, t.fontStyle, tokenStyleMode)
      let content = normalizeRenderedContent(t.content)
      i++

      while (i < tokens.length) {
        const t2 = tokens[i]
        const styleAttr2 = getTokenStyleAttr(t2.color, t2.fontStyle, tokenStyleMode)
        if (styleAttr2 !== styleAttr)
          break
        content += normalizeRenderedContent(t2.content)
        i++
      }

      tokensHtml += `<span${styleAttr}>${escapeHtml(content)}</span>`
    }
  }

  const ln = showLineNumbers && typeof lineNumber === 'number'
    ? `<span class="line-number" data-line="${lineNumber}"></span>`
    : ''
  return `${ln}${tokensHtml}`
}

function lineSignature(
  tokens: ThemedToken[],
  showLineNumbers: boolean,
  lineNumber: number | undefined,
  tokenStyleMode: TokenStyleMode,
): string {
  const parts: Array<string | number> = [
    tokenStyleMode,
    showLineNumbers && typeof lineNumber === 'number' ? lineNumber : '',
  ]

  let i = 0

  while (i < tokens.length) {
    const style = getTokenStyleSignature(tokens[i].color, tokens[i].fontStyle)
    let content = ''

    while (i < tokens.length) {
      const token = tokens[i]
      content += normalizeRenderedContent(token.content)
      i++

      if (tokenStyleMode !== 'class')
        break
      if (i >= tokens.length || getTokenStyleSignature(tokens[i].color, tokens[i].fontStyle) !== style)
        break
    }

    parts.push(style, content.length, content)
  }

  return JSON.stringify(parts)
}

/**
 * Create a DOM <span> element representing a line from tokens.
 * Builds children via createElement/textContent and merges adjacent class-mode
 * tokens with identical token styles to reduce node count.
 */
function createLineElement(
  tokens: ThemedToken[],
  showLineNumbers: boolean,
  lineNumber: number | undefined,
  lineClass: string,
  tokenStyleMode: TokenStyleMode,
  ownerDocument: Document,
  signature?: string,
): HTMLSpanElement {
  const span = ownerDocument.createElement('span')
  span.className = lineClass

  if (showLineNumbers && typeof lineNumber === 'number') {
    const ln = ownerDocument.createElement('span')
    ln.className = 'line-number'
    ln.dataset.line = String(lineNumber)
    span.appendChild(ln)
  }

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    const style = getTokenStyleSignature(t.color, t.fontStyle)
    let content = normalizeRenderedContent(t.content)
    i++

    if (tokenStyleMode === 'class') {
      while (i < tokens.length) {
        const t2 = tokens[i]
        const style2 = getTokenStyleSignature(t2.color, t2.fontStyle)
        if (style2 !== style)
          break
        content += normalizeRenderedContent(t2.content)
        i++
      }
    }

    const tspan = ownerDocument.createElement('span')
    applyTokenStyleToElement(tspan, t.color, t.fontStyle, tokenStyleMode)
    // Use textContent to avoid HTML parsing and to preserve escaped content
    tspan.textContent = content
    span.appendChild(tspan)
  }

  if (signature)
    rememberLineSignature(span, signature)

  return span
}

export interface TokenIncrementalOptions extends Omit<RenderOptions, 'preClass' | 'codeClass' | 'lineClass'> {
  preClass?: string
  codeClass?: string
  lineClass?: string
  /**
   * Optional precomputed token lines. When provided, the highlighter will NOT
   * be invoked and these tokens will be used directly (after padding to match
   * the code's line count). Useful for callers that cache grammar state (e.g.,
   * shiki-stream) and want to avoid re-tokenizing identical prefixes.
   */
  tokenLines?: ThemedToken[][]
  onResult?: (result: UpdateResult) => void
  /**
   * Compare mode for detecting the first diverged line.
   * - 'signature' (default): compare a compact per-line signature
   * - 'innerHTML': fallback to full innerHTML string comparison
   */
  compareMode?: 'signature' | 'innerHTML'
  /**
   * Skip tokenization when the input code is identical to the last update.
   * Defaults to true for updater instances; direct calls are unaffected.
   */
  skipSameCode?: boolean
  /**
   * Unsafe append-only fast path. When enabled and code is a strict prefix
   * extension of the previous update, this skips per-line divergence checks.
   * Defaults to false. Enable only when earlier token lines cannot change after
   * appending new source text.
   */
  appendOnlyFastPath?: boolean
  /**
   * Coalesce scheduled updates for this many milliseconds before rendering.
   * Defaults to 0, i.e. no extra timeout-based throttling.
   */
  throttleMs?: number
}

export function updateCodeTokensIncremental(
  container: HTMLElement | null | undefined,
  highlighter: Highlighter,
  code: string,
  opts: TokenIncrementalOptions,
): UpdateResult {
  if (!container)
    return 'noop'

  const {
    lang,
    theme,
    preClass = 'shiki',
    codeClass = '',
    lineClass = 'line',
    showLineNumbers = false,
    startingLineNumber: rawStartingLineNumber = 1,
    tokenLines: providedTokenLines,
  } = opts
  const startingLineNumber = normalizeStartingLineNumber(rawStartingLineNumber)
  const compareMode = opts.compareMode ?? 'signature'
  const ownerDocument = container.ownerDocument
  const styleRoot = getIncrementalStyleRoot(opts, container)
  const tokenStyleMode = resolveIncrementalTokenStyleMode(opts, styleRoot)
  const backgroundColor = getThemeBackgroundColor(highlighter, theme)
  const signature = renderSignature({
    lang,
    theme,
    backgroundColor,
    highlighterRevision: getHighlighterRevision(highlighter),
    tokenStyleMode,
    preClass,
    codeClass,
    lineClass,
    showLineNumbers,
    startingLineNumber,
  })

  const finishUpdate = (result: UpdateResult): UpdateResult => {
    setContainerRenderState(container, code, signature)
    opts.onResult?.(result)
    return result
  }

  const renderFull = (): UpdateResult => {
    container.innerHTML = renderCodeWithTokens(highlighter, code, {
      lang,
      theme,
      preClass,
      codeClass,
      lineClass,
      showLineNumbers,
      startingLineNumber,
      tokenCache: opts.tokenCache,
      tokenCacheMaxEntries: opts.tokenCacheMaxEntries,
      htmlCache: opts.htmlCache,
      htmlCacheMaxEntries: opts.htmlCacheMaxEntries,
      tokenLines: providedTokenLines,
      styleRoot,
      tokenStyleMode,
    })
    return finishUpdate('full')
  }

  // Ensure initial structure
  const codeEl = container.querySelector('code') as HTMLElement | null
  if (codeEl)
    ensureIncrementalTokenStyleSheet(styleRoot, tokenStyleMode)
  if (!codeEl)
    return renderFull()
  if (!hasExpectedRenderedShell(container, codeEl, { preClass, codeClass, backgroundColor }))
    return renderFull()

  const previousSignature = RENDER_SIGNATURES.get(container)
  if (previousSignature !== signature)
    return renderFull()

  const prevCode = LAST_CODE.get(container)
  if (typeof prevCode !== 'string')
    return renderFull()

  if ((codeEl.textContent ?? '').replace(/\r/g, '') !== prevCode.replace(/\r/g, ''))
    return renderFull()

  const oldLines = getCodeLineElements(codeEl, lineClass)
  if (!hasExpectedCodeLineStructure(codeEl, oldLines, prevCode, lineClass))
    return renderFull()

  const tokenLines = providedTokenLines
    ? normalizeTokenLinesForCode(providedTokenLines, code, true)
    : normalizeTokenLinesForCode(getTokenLines(highlighter, code, lang, theme, {
        tokenCache: opts.tokenCache,
        tokenCacheMaxEntries: opts.tokenCacheMaxEntries,
      }), code)
  const newLen = tokenLines.length
  const oldLen = oldLines.length

  const canAppendOnly = opts.appendOnlyFastPath === true
    && typeof prevCode === 'string'
    && prevCode.length > 0
    && code.startsWith(prevCode)
    && code !== prevCode

  if (canAppendOnly && oldLen > 0) {
    const prevLineCount = countLines(prevCode)
    if (prevLineCount === oldLen) {
      const lastIdx = oldLen - 1
      const lineNumber = showLineNumbers ? (startingLineNumber + lastIdx) : undefined
      const sig = compareMode === 'signature'
        ? lineSignature(tokenLines[lastIdx], showLineNumbers, lineNumber, tokenStyleMode)
        : undefined
      const newLineEl = createLineElement(
        tokenLines[lastIdx],
        showLineNumbers,
        lineNumber,
        lineClass,
        tokenStyleMode,
        ownerDocument,
        sig,
      )
      oldLines[lastIdx].innerHTML = ''
      while (newLineEl.firstChild)
        oldLines[lastIdx].appendChild(newLineEl.firstChild)
      if (sig)
        rememberLineSignature(oldLines[lastIdx], sig)

      if (newLen > oldLen) {
        const frag = ownerDocument.createDocumentFragment()
        let ln = startingLineNumber + oldLen
        for (let j = oldLen; j < newLen; j++) {
          frag.appendChild(ownerDocument.createTextNode('\n'))
          const lineNumber = showLineNumbers ? ln : undefined
          const sig = compareMode === 'signature'
            ? lineSignature(tokenLines[j], showLineNumbers, lineNumber, tokenStyleMode)
            : undefined
          const span = createLineElement(
            tokenLines[j],
            showLineNumbers,
            lineNumber,
            lineClass,
            tokenStyleMode,
            ownerDocument,
            sig,
          )
          frag.appendChild(span)
          ln++
        }
        codeEl.appendChild(frag)
      }
      ensureIncrementalTokenStyleSheet(styleRoot, tokenStyleMode)
      return finishUpdate('incremental')
    }
  }

  // Find first differing line by comparing innerHTML
  let divergeAt = -1
  const minLen = Math.min(oldLen, newLen)
  let currentLineNumber = startingLineNumber
  for (let idx = 0; idx < minLen; idx++) {
    const lineNumber = showLineNumbers ? currentLineNumber : undefined
    const oldLine = oldLines[idx]
    if (compareMode === 'signature') {
      const sig = lineSignature(tokenLines[idx], showLineNumbers, lineNumber, tokenStyleMode)
      const oldSig = getTrustedLineSignature(oldLine)
      if (oldSig) {
        if (oldSig !== sig) {
          divergeAt = idx
          break
        }
      }
      else {
        const newInner = lineInnerHtml(tokenLines[idx], showLineNumbers, lineNumber, tokenStyleMode)
        if (oldLine.innerHTML !== newInner) {
          divergeAt = idx
          break
        }
        rememberLineSignature(oldLine, sig)
      }
    }
    else {
      const newInner = lineInnerHtml(tokenLines[idx], showLineNumbers, lineNumber, tokenStyleMode)
      if (oldLine.innerHTML !== newInner) {
        divergeAt = idx
        break
      }
    }
    currentLineNumber++
  }

  if (divergeAt === -1) {
    // All shared lines match; append any new lines
    if (newLen > oldLen) {
      const frag = ownerDocument.createDocumentFragment()
      let ln = startingLineNumber + oldLen
      for (let j = oldLen; j < newLen; j++) {
        // Insert a newline separator before each appended line to match Shiki's codeToHtml
        frag.appendChild(ownerDocument.createTextNode('\n'))
        const lineNumber = showLineNumbers ? ln : undefined
        const sig = compareMode === 'signature'
          ? lineSignature(tokenLines[j], showLineNumbers, lineNumber, tokenStyleMode)
          : undefined
        const span = createLineElement(
          tokenLines[j],
          showLineNumbers,
          lineNumber,
          lineClass,
          tokenStyleMode,
          ownerDocument,
          sig,
        )
        frag.appendChild(span)
        ln++
      }
      codeEl.appendChild(frag)
      ensureIncrementalTokenStyleSheet(styleRoot, tokenStyleMode)
      return finishUpdate('incremental')
    }

    if (newLen < oldLen)
      return renderFull()

    ensureIncrementalTokenStyleSheet(styleRoot, tokenStyleMode)
    return finishUpdate('noop')
  }

  // Divergence at or after last existing line -> update that line and append others
  if (divergeAt >= oldLen - 1) {
    const lineNumber = showLineNumbers ? (startingLineNumber + divergeAt) : undefined
    const sig = compareMode === 'signature'
      ? lineSignature(tokenLines[divergeAt], showLineNumbers, lineNumber, tokenStyleMode)
      : undefined
    const newLineEl = createLineElement(
      tokenLines[divergeAt],
      showLineNumbers,
      lineNumber,
      lineClass,
      tokenStyleMode,
      ownerDocument,
      sig,
    )
    // Replace children of the existing line element with the newly built nodes
    oldLines[divergeAt].innerHTML = ''
    while (newLineEl.firstChild)
      oldLines[divergeAt].appendChild(newLineEl.firstChild)
    if (sig)
      rememberLineSignature(oldLines[divergeAt], sig)

    if (newLen > oldLen) {
      const frag = ownerDocument.createDocumentFragment()
      let ln = startingLineNumber + oldLen
      for (let j = oldLen; j < newLen; j++) {
        // Maintain newline separators between .line spans to match codeToHtml
        frag.appendChild(ownerDocument.createTextNode('\n'))
        const lineNumber = showLineNumbers ? ln : undefined
        const sig = compareMode === 'signature'
          ? lineSignature(tokenLines[j], showLineNumbers, lineNumber, tokenStyleMode)
          : undefined
        const span = createLineElement(
          tokenLines[j],
          showLineNumbers,
          lineNumber,
          lineClass,
          tokenStyleMode,
          ownerDocument,
          sig,
        )
        frag.appendChild(span)
        ln++
      }
      codeEl.appendChild(frag)
    }
    ensureIncrementalTokenStyleSheet(styleRoot, tokenStyleMode)
    return finishUpdate('incremental')
  }

  // Divergence earlier -> full replace for correctness
  return renderFull()
}

export interface TokenIncrementalUpdater {
  update: (code: string, tokenLines?: ThemedToken[][]) => UpdateResult
  reset: () => void
  cancel?: () => void
  dispose: () => void
}

function callScheduledOnResult(onResult: TokenIncrementalOptions['onResult'], result: UpdateResult): void {
  if (!onResult)
    return
  try {
    onResult(result)
  }
  catch (error) {
    console.error('stream-markdown scheduled token update onResult error', error)
  }
}

export function createTokenIncrementalUpdater(
  container: HTMLElement | null | undefined,
  highlighter: Highlighter,
  opts: TokenIncrementalOptions,
): TokenIncrementalUpdater {
  let alive = true
  let target: HTMLElement | null | undefined = container
  let lastCode: string | null = null
  let lastUpdateUsedProvidedTokenLines = false
  let updateSeq = 0

  return {
    update: (code: string, tokenLines?: ThemedToken[][]) => {
      if (!alive)
        return 'noop'
      if (!target)
        return 'noop'
      const hasProvidedTokenLines = tokenLines !== undefined
      const skipSame = !hasProvidedTokenLines && !lastUpdateUsedProvidedTokenLines && opts.skipSameCode !== false
      if (skipSame && lastCode === code) {
        const codeEl = target.querySelector('code') as HTMLElement | null
        const styleRoot = getIncrementalStyleRoot(opts, target)
        const tokenStyleMode = resolveIncrementalTokenStyleMode(opts, styleRoot)
        const preClass = opts.preClass ?? 'shiki'
        const codeClass = opts.codeClass ?? ''
        const lineClass = opts.lineClass ?? 'line'
        const showLineNumbers = opts.showLineNumbers ?? false
        const backgroundColor = getThemeBackgroundColor(highlighter, opts.theme)
        const startingLineNumber = normalizeStartingLineNumber(opts.startingLineNumber ?? 1)
        const signature = renderSignature({
          lang: opts.lang,
          theme: opts.theme,
          backgroundColor,
          highlighterRevision: getHighlighterRevision(highlighter),
          tokenStyleMode,
          preClass,
          codeClass,
          lineClass,
          showLineNumbers,
          startingLineNumber,
        })
        if (
          codeEl
          && hasExpectedRenderedShell(target, codeEl, { preClass, codeClass, backgroundColor })
          && RENDER_SIGNATURES.get(target) === signature
          && hasUnchangedRenderedCodeDom(target, codeEl)
          && (codeEl.textContent ?? '').replace(/\r/g, '') === code.replace(/\r/g, '')
        ) {
          ensureIncrementalTokenStyleSheet(styleRoot, tokenStyleMode)
          opts.onResult?.('noop')
          return 'noop'
        }
      }
      // `opts.onResult` may synchronously re-enter `update()` from inside
      // `updateCodeTokensIncremental`. Do not let the outer call overwrite the
      // newer `lastCode` written by the nested update.
      let onResultError: unknown
      const nextOpts: TokenIncrementalOptions = {
        ...opts,
        ...(hasProvidedTokenLines ? { tokenLines } : {}),
        onResult: (result) => {
          try {
            opts.onResult?.(result)
          }
          catch (error) {
            onResultError = error
          }
        },
      }

      const seq = ++updateSeq
      const res = updateCodeTokensIncremental(target, highlighter, code, nextOpts)
      if (seq === updateSeq) {
        lastCode = code
        lastUpdateUsedProvidedTokenLines = hasProvidedTokenLines
      }

      if (onResultError !== undefined)
        throw onResultError

      return res
    },
    reset: () => {
      if (!alive || !target)
        return
      target.innerHTML = ''
      clearContainerRenderState(target)
      lastCode = null
      lastUpdateUsedProvidedTokenLines = false
      updateSeq++
    },
    cancel: () => {},
    dispose: () => {
      alive = false
      target = null
      lastCode = null
      lastUpdateUsedProvidedTokenLines = false
      updateSeq++
    },
  }
}

// --- Scheduler: deferred, prioritized token updates -------------------------
// This lightweight scheduler defers token updates to idle time (requestIdleCallback)
// and prioritizes visible containers (via IntersectionObserver). It deduplicates
// updates per container: the latest scheduled update for the same container wins.
// NOTE: scheduled updates are asynchronous; the `update` returned from
// `createScheduledTokenIncrementalUpdater` returns 'noop' synchronously and the
// final UpdateResult is delivered via `opts.onResult` when the task runs.

interface ScheduledTask {
  id: number
  container: HTMLElement
  highlighter: Highlighter
  code: string
  opts: TokenIncrementalOptions
  tokenLines?: ThemedToken[][]
  // estimated DOM nodes this task will create (approx)
  estNodes?: number
  shouldRun?: () => boolean
}

type IdleHandle = number | ReturnType<typeof setTimeout>

function getIntersectionObserverConstructor(container?: HTMLElement): typeof IntersectionObserver | null {
  const ownerWindow = container?.ownerDocument?.defaultView as any
  if (typeof ownerWindow?.IntersectionObserver === 'function')
    return ownerWindow.IntersectionObserver

  const win = typeof window !== 'undefined' ? (window as any) : null
  if (typeof win?.IntersectionObserver === 'function')
    return win.IntersectionObserver

  const globalScope = globalThis as any
  return typeof globalScope.IntersectionObserver === 'function'
    ? globalScope.IntersectionObserver
    : null
}

class TokenUpdateScheduler {
  private queue: ScheduledTask[] = []
  private byContainer = new WeakMap<HTMLElement, ScheduledTask>()
  private visible = new WeakMap<HTMLElement, boolean>()
  private io: IntersectionObserver | null = null
  private idleScheduled = false
  private idleHandle: IdleHandle | null = null
  private idleCancel: ((handle: IdleHandle) => void) | null = null
  private idleToken = 0
  private nextId = 1

  private ensureIntersectionObserver(container: HTMLElement) {
    if (this.io)
      return

    try {
      const IntersectionObserverCtor = getIntersectionObserverConstructor(container)
      if (IntersectionObserverCtor) {
        this.io = new IntersectionObserverCtor((entries) => {
          for (const e of entries)
            this.visible.set(e.target as HTMLElement, e.isIntersecting)
        }, { root: null, threshold: 0 })
      }
      else {
        this.io = null
      }
    }
    catch {
      this.io = null
    }
  }

  schedule(
    container: HTMLElement,
    highlighter: Highlighter,
    code: string,
    opts: TokenIncrementalOptions,
    tokenLines?: ThemedToken[][],
    shouldRun?: () => boolean,
  ) {
    // Deduplicate: if a task already exists for this container, replace its payload
    const prev = this.byContainer.get(container)
    if (prev) {
      prev.id = this.nextId++
      prev.code = code
      prev.highlighter = highlighter
      prev.opts = opts
      prev.tokenLines = cloneTokenLines(tokenLines)
      prev.estNodes = estimateNodeCost(code)
      prev.shouldRun = shouldRun
      return prev.id
    }

    const task: ScheduledTask = {
      id: this.nextId++,
      container,
      highlighter,
      code,
      opts,
      tokenLines: cloneTokenLines(tokenLines),
      estNodes: estimateNodeCost(code),
      shouldRun,
    }
    this.queue.push(task)
    this.byContainer.set(container, task)
    this.ensureIntersectionObserver(container)
    if (this.io) {
      try {
        this.io.observe(container)
      }
      catch {}
    }

    this.ensureProcessing()
    return task.id
  }

  private cancelIdle() {
    if (!this.idleScheduled)
      return

    const handle = this.idleHandle
    const cancel = this.idleCancel

    this.idleToken++
    this.idleScheduled = false
    this.idleHandle = null
    this.idleCancel = null

    if (handle !== null && cancel) {
      try {
        cancel(handle)
      }
      catch {}
    }
  }

  private ensureProcessing() {
    if (this.idleScheduled || this.queue.length === 0)
      return

    const globalScope = globalThis as any
    const win = this.queue[0]?.container.ownerDocument?.defaultView as any
    const ricOwner = win && typeof win.requestIdleCallback === 'function'
      ? win
      : typeof globalScope.requestIdleCallback === 'function'
        ? globalScope
        : null
    const ric = ricOwner?.requestIdleCallback

    this.idleScheduled = true
    const token = ++this.idleToken
    let ranSynchronously = false
    const run = (deadline: any) => {
      if (token !== this.idleToken)
        return

      ranSynchronously = true
      this.idleScheduled = false
      this.idleHandle = null
      this.idleCancel = null
      this.process(deadline)
    }

    if (ric) {
      try {
        const handle = ric.call(ricOwner, run, { timeout: 100 })
        if (ranSynchronously)
          return

        this.idleHandle = handle
        this.idleCancel = typeof ricOwner.cancelIdleCallback === 'function'
          ? handle => ricOwner.cancelIdleCallback(handle)
          : null
        return
      }
      catch {
        if (ranSynchronously)
          return
      }
    }

    const fallbackToken = ++this.idleToken
    const fallbackRun = (deadline: any) => {
      if (fallbackToken !== this.idleToken)
        return

      ranSynchronously = true
      this.idleScheduled = false
      this.idleHandle = null
      this.idleCancel = null
      this.process(deadline)
    }

    const handle = setTimeout(() => fallbackRun({ timeRemaining: () => 50, didTimeout: true }), 50)
    this.idleHandle = handle
    this.idleCancel = handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }

  private stopObserving(container: HTMLElement) {
    if (this.io) {
      try {
        this.io.unobserve(container)
      }
      catch {}
    }
    this.visible.delete(container)
  }

  private process(deadline: any) {
    // Process visible tasks first. Use an adaptive limit per idle callback to
    // avoid creating a long main-thread task when many containers are queued.
    // The allowed tasks scale with deadline.timeRemaining() to be responsive on
    // busy frames. We clamp between 1 and 8 tasks per tick.
    const timeRem = getIdleTimeRemaining(deadline)
    // Budget nodes per tick based on time remaining. Heuristic: ~6 nodes/ms.
    const allowedNodes = Math.min(2000, Math.max(100, Math.floor(timeRem * 6)))
    let nodesProcessed = 0

    while (this.queue.length) {
      // stop if we've exhausted node budget
      if (nodesProcessed >= allowedNodes)
        break
      // pick visible task if any
      let idx = this.queue.findIndex(t => this.visible.get(t.container) === true)
      if (idx === -1)
        idx = 0

      const task = this.queue.splice(idx, 1)[0]
      this.byContainer.delete(task.container)

      if (task.shouldRun && !task.shouldRun()) {
        if (!this.byContainer.has(task.container))
          this.stopObserving(task.container)
        continue
      }

      // If this task has an estimated node cost and it would exceed the
      // remaining budget, push it back and stop processing to avoid long tasks.
      // However, if this is the first task this tick (nodesProcessed === 0)
      // and it alone exceeds the budget, run it anyway to avoid starvation
      // for very large updates that can never "fit" within the heuristic.
      if (typeof task.estNodes === 'number' && (nodesProcessed + task.estNodes) > allowedNodes) {
        if (nodesProcessed === 0) {
          // Fall through to process this oversized task once, ensuring progress.
        }
        else {
          // re-queue at the end and process in a later tick
          this.queue.push(task)
          this.byContainer.set(task.container, task)
          break
        }
      }

      try {
        updateCodeTokensIncremental(
          task.container,
          task.highlighter,
          task.code,
          task.tokenLines ? { ...task.opts, tokenLines: task.tokenLines } : task.opts,
        )
      }
      catch {
        // On unexpected error, fall back to full replace and notify
        try {
          const styleRoot = getIncrementalStyleRoot(task.opts, task.container)
          const tokenStyleMode = resolveIncrementalTokenStyleMode(task.opts, styleRoot)
          task.container.innerHTML = renderCodeWithTokens(task.highlighter, task.code, {
            lang: task.opts.lang,
            theme: task.opts.theme,
            preClass: task.opts.preClass,
            codeClass: task.opts.codeClass,
            lineClass: task.opts.lineClass,
            showLineNumbers: task.opts.showLineNumbers,
            startingLineNumber: task.opts.startingLineNumber,
            tokenCache: task.opts.tokenCache,
            tokenCacheMaxEntries: task.opts.tokenCacheMaxEntries,
            htmlCache: task.opts.htmlCache,
            htmlCacheMaxEntries: task.opts.htmlCacheMaxEntries,
            tokenLines: task.tokenLines,
            styleRoot,
            tokenStyleMode,
          })
          setContainerRenderState(task.container, task.code, renderSignature({
            lang: task.opts.lang,
            theme: task.opts.theme,
            backgroundColor: getThemeBackgroundColor(task.highlighter, task.opts.theme),
            highlighterRevision: getHighlighterRevision(task.highlighter),
            tokenStyleMode,
            preClass: task.opts.preClass ?? 'shiki',
            codeClass: task.opts.codeClass ?? '',
            lineClass: task.opts.lineClass ?? 'line',
            showLineNumbers: task.opts.showLineNumbers ?? false,
            startingLineNumber: normalizeStartingLineNumber(task.opts.startingLineNumber ?? 1),
          }))
          callScheduledOnResult(task.opts.onResult, 'full')
        }
        catch {
          callScheduledOnResult(task.opts.onResult, 'noop')
        }
      }

      if (typeof task.estNodes === 'number')
        nodesProcessed += task.estNodes
      else
        nodesProcessed += 50 // fallback conservative increment

      if (!this.byContainer.has(task.container))
        this.stopObserving(task.container)

      // stop processing if time is low to keep UI responsive
      if (getIdleTimeRemaining(deadline) < 6) {
        break
      }
    }

    // If queue still has items, schedule another idle callback
    if (this.queue.length) {
      this.ensureProcessing()
    }
  }

  cancelFor(container: HTMLElement, taskId?: number) {
    const prev = this.byContainer.get(container)
    if (prev) {
      if (taskId !== undefined && prev.id !== taskId)
        return

      this.byContainer.delete(container)
      const idx = this.queue.findIndex(t => t.id === prev.id)
      if (idx !== -1)
        this.queue.splice(idx, 1)
    }
    if (this.queue.length === 0)
      this.cancelIdle()

    this.stopObserving(container)
  }
}

const globalTokenUpdateScheduler = new TokenUpdateScheduler()

export function createScheduledTokenIncrementalUpdater(
  container: HTMLElement | null | undefined,
  highlighter: Highlighter,
  opts: TokenIncrementalOptions,
): TokenIncrementalUpdater {
  let alive = true
  let target: HTMLElement | null | undefined = container
  let scheduledTaskId: number | null = null
  let pendingCode: string | null = null
  let pendingTokenLines: ThemedToken[][] | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  let updateGeneration = 0
  let lastCode: string | null = null
  let lastUpdateUsedProvidedTokenLines = false

  const isRenderedCodeUnchanged = (code: string, hasProvidedTokenLines: boolean): boolean => {
    if (!target || hasProvidedTokenLines || lastUpdateUsedProvidedTokenLines || opts.skipSameCode === false)
      return false
    if (lastCode !== code)
      return false

    const codeEl = target.querySelector('code') as HTMLElement | null
    if (!codeEl)
      return false

    const preClass = opts.preClass ?? 'shiki'
    const codeClass = opts.codeClass ?? ''
    const backgroundColor = getThemeBackgroundColor(highlighter, opts.theme)
    if (!hasExpectedRenderedShell(target, codeEl, { preClass, codeClass, backgroundColor }))
      return false

    const styleRoot = getIncrementalStyleRoot(opts, target)
    const tokenStyleMode = resolveIncrementalTokenStyleMode(opts, styleRoot)
    const lineClass = opts.lineClass ?? 'line'
    const showLineNumbers = opts.showLineNumbers ?? false
    const startingLineNumber = normalizeStartingLineNumber(opts.startingLineNumber ?? 1)
    const signature = renderSignature({
      lang: opts.lang,
      theme: opts.theme,
      backgroundColor,
      highlighterRevision: getHighlighterRevision(highlighter),
      tokenStyleMode,
      preClass,
      codeClass,
      lineClass,
      showLineNumbers,
      startingLineNumber,
    })

    if (RENDER_SIGNATURES.get(target) !== signature)
      return false
    if (!hasUnchangedRenderedCodeDom(target, codeEl))
      return false
    if ((codeEl.textContent ?? '').replace(/\r/g, '') !== code.replace(/\r/g, ''))
      return false

    ensureIncrementalTokenStyleSheet(styleRoot, tokenStyleMode)
    return true
  }

  const cancelScheduledTask = () => {
    if (!target || scheduledTaskId == null)
      return
    const taskId = scheduledTaskId
    scheduledTaskId = null
    globalTokenUpdateScheduler.cancelFor(target, taskId)
  }

  const cancelPendingWork = () => {
    updateGeneration++
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pendingCode = null
    pendingTokenLines = undefined
    cancelScheduledTask()
  }

  const flush = () => {
    timer = null
    if (!alive || !target || pendingCode == null)
      return

    const code = pendingCode
    const targetEl = target
    const tokenLines = pendingTokenLines
    const hasProvidedTokenLines = tokenLines !== undefined
    pendingCode = null
    pendingTokenLines = undefined

    const userOnResult = opts.onResult
    const taskGeneration = updateGeneration
    let taskId = -1
    let completedSynchronously = false

    const updateOpts: TokenIncrementalOptions = {
      ...opts,
      appendOnlyFastPath: opts.appendOnlyFastPath ?? false,
      onResult: (result) => {
        completedSynchronously = true
        if (updateGeneration === taskGeneration && scheduledTaskId === taskId)
          scheduledTaskId = null
        if (updateGeneration === taskGeneration) {
          lastCode = code
          lastUpdateUsedProvidedTokenLines = hasProvidedTokenLines
        }
        callScheduledOnResult(userOnResult, result)
      },
    }

    // Schedule the update; result will be delivered via opts.onResult when executed
    taskId = globalTokenUpdateScheduler.schedule(
      targetEl,
      highlighter,
      code,
      updateOpts,
      tokenLines,
      () => alive && target === targetEl && updateGeneration === taskGeneration,
    )
    if (!completedSynchronously)
      scheduledTaskId = taskId
  }

  const scheduleFlush = () => {
    const throttleMs = normalizeDelayMs(opts.throttleMs)
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (throttleMs <= 0) {
      flush()
      return
    }
    timer = setTimeout(flush, throttleMs)
  }

  return {
    update: (code: string, tokenLines?: ThemedToken[][]) => {
      if (!alive || !target)
        return 'noop'

      const hasProvidedTokenLines = tokenLines !== undefined
      if (isRenderedCodeUnchanged(code, hasProvidedTokenLines)) {
        cancelPendingWork()
        callScheduledOnResult(opts.onResult, 'noop')
        return 'noop'
      }

      updateGeneration++
      cancelScheduledTask()
      pendingCode = code
      pendingTokenLines = cloneTokenLines(tokenLines)
      scheduleFlush()
      // Synchronous return is 'noop' since actual rendering will occur later
      return 'noop'
    },
    reset: () => {
      if (!alive || !target)
        return
      cancelPendingWork()
      target.innerHTML = ''
      clearContainerRenderState(target)
      lastCode = null
      lastUpdateUsedProvidedTokenLines = false
    },
    cancel: cancelPendingWork,
    dispose: () => {
      alive = false
      cancelPendingWork()
      target = null
      lastCode = null
      lastUpdateUsedProvidedTokenLines = false
      // leave container as-is; caller may remove
    },
  }
}
