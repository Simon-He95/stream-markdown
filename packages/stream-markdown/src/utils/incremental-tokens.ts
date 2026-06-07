import type { Highlighter } from 'shiki'
import type { RenderOptions, ThemedToken } from './shiki-render.js'
import type { TokenStyleMode } from './token-style.js'
import { renderCodeWithTokens } from './shiki-render.js'
import { getTokenLines } from './token-cache.js'
import {
  canUseTokenStyleClasses,
  ensureTokenStyleSheet,
  getTokenClassName,
  getTokenStyleAttr,
  getTokenStyleSignature,
  normalizeCssColor,
} from './token-style.js'

export type UpdateResult = 'incremental' | 'full' | 'noop'

const RENDER_SIGNATURES = new WeakMap<HTMLElement, string>()
const LINE_SIGNATURES = new WeakMap<HTMLElement, string>()
const LAST_CODE = new WeakMap<HTMLElement, string>()

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

function estimateNodeCost(code: string): number {
  const lineCount = countLines(code)
  const estTokenSpans = Math.ceil(code.length / 6)
  return Math.min(8000, lineCount + estTokenSpans)
}

function escapeHtml(str: string): string {
  return str.replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderSignature(options: {
  lang: string
  theme: string
  backgroundColor: string
  tokenStyleMode: TokenStyleMode
  preClass: string
  codeClass: string
  lineClass: string
  showLineNumbers: boolean
  startingLineNumber: number
}): string {
  return [
    options.lang,
    options.theme,
    options.backgroundColor,
    options.tokenStyleMode,
    options.preClass,
    options.codeClass,
    options.lineClass,
    options.showLineNumbers ? '1' : '0',
    String(options.startingLineNumber),
  ].join('\u0001')
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

function clearContainerRenderState(container: HTMLElement): void {
  LAST_CODE.delete(container)
  RENDER_SIGNATURES.delete(container)
}

function setContainerRenderState(container: HTMLElement, code: string, signature: string): void {
  LAST_CODE.set(container, code)
  RENDER_SIGNATURES.set(container, signature)
}

function getIncrementalStyleRoot(opts: { styleRoot?: Node | null }, container: HTMLElement): Node | null {
  return opts.styleRoot === undefined ? container : opts.styleRoot
}

function resolveIncrementalTokenStyleMode(
  opts: { tokenStyleMode?: TokenStyleMode },
  styleRoot: Node | null,
): TokenStyleMode {
  const requested = opts.tokenStyleMode ?? 'class'
  return requested === 'class' && canUseTokenStyleClasses(styleRoot)
    ? 'class'
    : 'inline'
}

function ensureIncrementalTokenStyleSheet(styleRoot: Node | null, tokenStyleMode: TokenStyleMode): void {
  if (tokenStyleMode === 'class')
    ensureTokenStyleSheet(styleRoot)
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
      let content = t.content
      i++

      while (i < tokens.length) {
        const t2 = tokens[i]
        const styleAttr2 = getTokenStyleAttr(t2.color, t2.fontStyle, tokenStyleMode)
        if (styleAttr2 !== styleAttr)
          break
        content += t2.content
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

function lineSignature(tokens: ThemedToken[], showLineNumbers: boolean, lineNumber?: number): string {
  let sig = showLineNumbers && typeof lineNumber === 'number'
    ? `#${lineNumber}|`
    : '#|'
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    const style = getTokenStyleSignature(t.color, t.fontStyle)
    let content = t.content
    i++

    while (i < tokens.length) {
      const t2 = tokens[i]
      const style2 = getTokenStyleSignature(t2.color, t2.fontStyle)
      if (style2 !== style)
        break
      content += t2.content
      i++
    }

    sig += `${content.length}:${content}|${style};`
  }
  return sig
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
  if (signature)
    LINE_SIGNATURES.set(span, signature)

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
    let content = t.content
    i++

    if (tokenStyleMode === 'class') {
      while (i < tokens.length) {
        const t2 = tokens[i]
        const style2 = getTokenStyleSignature(t2.color, t2.fontStyle)
        if (style2 !== style)
          break
        content += t2.content
        i++
      }
    }

    const tspan = ownerDocument.createElement('span')
    if (tokenStyleMode === 'class') {
      const className = getTokenClassName(t.color, t.fontStyle)
      if (className)
        tspan.className = className
    }
    else if (style) {
      tspan.setAttribute('style', style)
    }
    // Use textContent to avoid HTML parsing and to preserve escaped content
    tspan.textContent = content
    span.appendChild(tspan)
  }

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
    startingLineNumber = 1,
    tokenLines: providedTokenLines,
  } = opts
  const compareMode = opts.compareMode ?? 'signature'
  const ownerDocument = container.ownerDocument
  const styleRoot = getIncrementalStyleRoot(opts, container)
  const tokenStyleMode = resolveIncrementalTokenStyleMode(opts, styleRoot)
  const backgroundColor = getThemeBackgroundColor(highlighter, theme)
  const signature = renderSignature({
    lang,
    theme,
    backgroundColor,
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

  const previousSignature = RENDER_SIGNATURES.get(container)
  if (previousSignature !== signature)
    return renderFull()

  const oldLines = codeEl.getElementsByClassName(lineClass) as HTMLCollectionOf<HTMLElement>
  const tokenLines = providedTokenLines
    ? normalizeTokenLinesForCode(providedTokenLines, code, true)
    : normalizeTokenLinesForCode(getTokenLines(highlighter, code, lang, theme, {
        tokenCache: opts.tokenCache,
        tokenCacheMaxEntries: opts.tokenCacheMaxEntries,
      }), code)
  const newLen = tokenLines.length
  const oldLen = oldLines.length

  const prevCode = LAST_CODE.get(container)
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
        ? lineSignature(tokenLines[lastIdx], showLineNumbers, lineNumber)
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
        LINE_SIGNATURES.set(oldLines[lastIdx], sig)

      if (newLen > oldLen) {
        const frag = ownerDocument.createDocumentFragment()
        let ln = startingLineNumber + oldLen
        for (let j = oldLen; j < newLen; j++) {
          frag.appendChild(ownerDocument.createTextNode('\n'))
          const lineNumber = showLineNumbers ? ln : undefined
          const sig = compareMode === 'signature'
            ? lineSignature(tokenLines[j], showLineNumbers, lineNumber)
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
      const sig = lineSignature(tokenLines[idx], showLineNumbers, lineNumber)
      const oldSig = LINE_SIGNATURES.get(oldLine)
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
        LINE_SIGNATURES.set(oldLine, sig)
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
        const sig = compareMode === 'signature' ? lineSignature(tokenLines[j], showLineNumbers, lineNumber) : undefined
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
    const sig = compareMode === 'signature' ? lineSignature(tokenLines[divergeAt], showLineNumbers, lineNumber) : undefined
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
      LINE_SIGNATURES.set(oldLines[divergeAt], sig)

    if (newLen > oldLen) {
      const frag = ownerDocument.createDocumentFragment()
      let ln = startingLineNumber + oldLen
      for (let j = oldLen; j < newLen; j++) {
        // Maintain newline separators between .line spans to match codeToHtml
        frag.appendChild(ownerDocument.createTextNode('\n'))
        const lineNumber = showLineNumbers ? ln : undefined
        const sig = compareMode === 'signature' ? lineSignature(tokenLines[j], showLineNumbers, lineNumber) : undefined
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
  let updateSeq = 0

  return {
    update: (code: string, tokenLines?: ThemedToken[][]) => {
      if (!alive)
        return 'noop'
      if (!target)
        return 'noop'
      const skipSame = tokenLines == null && opts.skipSameCode !== false
      if (skipSame && lastCode === code) {
        const codeEl = target.querySelector('code')
        const styleRoot = getIncrementalStyleRoot(opts, target)
        const tokenStyleMode = resolveIncrementalTokenStyleMode(opts, styleRoot)
        const signature = renderSignature({
          lang: opts.lang,
          theme: opts.theme,
          backgroundColor: getThemeBackgroundColor(highlighter, opts.theme),
          tokenStyleMode,
          preClass: opts.preClass ?? 'shiki',
          codeClass: opts.codeClass ?? '',
          lineClass: opts.lineClass ?? 'line',
          showLineNumbers: opts.showLineNumbers ?? false,
          startingLineNumber: opts.startingLineNumber ?? 1,
        })
        if (
          codeEl
          && RENDER_SIGNATURES.get(target) === signature
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
        ...(tokenLines ? { tokenLines } : {}),
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
      if (seq === updateSeq)
        lastCode = code

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
      updateSeq++
    },
    cancel: () => {},
    dispose: () => {
      alive = false
      target = null
      lastCode = null
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
}

type IdleHandle = number | ReturnType<typeof setTimeout>

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

  constructor() {
    try {
      this.io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          this.visible.set(e.target as HTMLElement, e.isIntersecting)
        }
      }, { root: null, threshold: 0 })
    }
    catch {
      this.io = null
    }
  }

  schedule(container: HTMLElement, highlighter: Highlighter, code: string, opts: TokenIncrementalOptions, tokenLines?: ThemedToken[][]) {
    // Deduplicate: if a task already exists for this container, replace its payload
    const prev = this.byContainer.get(container)
    if (prev) {
      prev.id = this.nextId++
      prev.code = code
      prev.highlighter = highlighter
      prev.opts = opts
      prev.tokenLines = tokenLines
      prev.estNodes = estimateNodeCost(code)
      return prev.id
    }

    const task: ScheduledTask = {
      id: this.nextId++,
      container,
      highlighter,
      code,
      opts,
      tokenLines,
      estNodes: estimateNodeCost(code),
    }
    this.queue.push(task)
    this.byContainer.set(container, task)
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

    const handle = setTimeout(() => run({ timeRemaining: () => 50, didTimeout: true }), 50)
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
    const timeRem = typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 50
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
            tokenStyleMode,
            preClass: task.opts.preClass ?? 'shiki',
            codeClass: task.opts.codeClass ?? '',
            lineClass: task.opts.lineClass ?? 'line',
            showLineNumbers: task.opts.showLineNumbers ?? false,
            startingLineNumber: task.opts.startingLineNumber ?? 1,
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
      if (typeof deadline?.timeRemaining === 'function' && deadline.timeRemaining() < 6) {
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

  const cancelScheduledTask = () => {
    if (!target || scheduledTaskId == null)
      return
    const taskId = scheduledTaskId
    scheduledTaskId = null
    globalTokenUpdateScheduler.cancelFor(target, taskId)
  }

  const cancelPendingWork = () => {
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
    pendingCode = null
    pendingTokenLines = undefined

    const userOnResult = opts.onResult
    let taskId = -1
    let completedSynchronously = false

    const updateOpts: TokenIncrementalOptions = {
      ...opts,
      appendOnlyFastPath: opts.appendOnlyFastPath ?? false,
      onResult: (result) => {
        completedSynchronously = true
        if (scheduledTaskId === taskId)
          scheduledTaskId = null
        callScheduledOnResult(userOnResult, result)
      },
    }

    // Schedule the update; result will be delivered via opts.onResult when executed
    taskId = globalTokenUpdateScheduler.schedule(targetEl, highlighter, code, updateOpts, tokenLines)
    if (!completedSynchronously)
      scheduledTaskId = taskId
  }

  const scheduleFlush = () => {
    const throttleMs = opts.throttleMs ?? 0
    if (throttleMs <= 0) {
      flush()
      return
    }
    if (timer === null)
      timer = setTimeout(flush, throttleMs)
  }

  return {
    update: (code: string, tokenLines?: ThemedToken[][]) => {
      if (!alive || !target)
        return 'noop'

      cancelScheduledTask()
      pendingCode = code
      pendingTokenLines = tokenLines
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
    },
    cancel: cancelPendingWork,
    dispose: () => {
      alive = false
      cancelPendingWork()
      target = null
      // leave container as-is; caller may remove
    },
  }
}
