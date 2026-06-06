import type { Highlighter } from 'shiki'
import type { RenderOptions, ThemedToken } from './shiki-render.js'
import { renderCodeWithTokens } from './shiki-render.js'
import { getTokenLines } from './token-cache.js'
import { ensureTokenStyleSheet, getTokenClassName, getTokenStyleAttr, getTokenStyleSignature } from './token-style.js'

export type UpdateResult = 'incremental' | 'full' | 'noop'

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

function lineInnerHtml(tokens: ThemedToken[], showLineNumbers: boolean, lineNumber?: number): string {
  let tokensHtml = ''
  let i = 0

  while (i < tokens.length) {
    const t = tokens[i]
    const styleAttr = getTokenStyleAttr(t.color, t.fontStyle, 'class')
    let content = t.content
    i++

    while (i < tokens.length) {
      const t2 = tokens[i]
      const styleAttr2 = getTokenStyleAttr(t2.color, t2.fontStyle, 'class')
      if (styleAttr2 !== styleAttr)
        break
      content += t2.content
      i++
    }

    tokensHtml += `<span${styleAttr}>${escapeHtml(content)}</span>`
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
 * Builds children via createElement/textContent and merges adjacent tokens
 * with identical token styles to reduce node count.
 */
function createLineElement(
  tokens: ThemedToken[],
  showLineNumbers: boolean,
  lineNumber: number | undefined,
  lineClass: string,
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

  // Merge adjacent tokens with identical style string to reduce DOM nodes
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    const className = getTokenClassName(t.color, t.fontStyle)
    let content = t.content
    i++

    while (i < tokens.length) {
      const t2 = tokens[i]
      const className2 = getTokenClassName(t2.color, t2.fontStyle)
      if (className2 !== className)
        break
      content += t2.content
      i++
    }

    const tspan = ownerDocument.createElement('span')
    if (className)
      tspan.className = className
    // Use textContent to avoid HTML parsing and to preserve escaped content
    tspan.textContent = content
    span.appendChild(tspan)
  }

  return span
}

export interface TokenIncrementalOptions extends Omit<RenderOptions, 'preClass' | 'codeClass' | 'lineClass' | 'tokenStyleMode'> {
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
  const styleRoot = opts.styleRoot ?? container

  // Ensure initial structure
  const codeEl = container.querySelector('code') as HTMLElement | null
  if (codeEl)
    ensureTokenStyleSheet(styleRoot)
  if (!codeEl) {
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
      tokenStyleMode: 'class',
    })
    opts.onResult?.('full')
    LAST_CODE.set(container, code)
    return 'full'
  }

  const oldLines = codeEl.getElementsByClassName(lineClass) as HTMLCollectionOf<HTMLElement>
  let tokenLines = providedTokenLines
    // clone per line so we can pad without mutating caller-owned arrays
    ? providedTokenLines.map(line => line.slice())
    : getTokenLines(highlighter, code, lang, theme, {
        tokenCache: opts.tokenCache,
        tokenCacheMaxEntries: opts.tokenCacheMaxEntries,
      })
  // Normalize to preserve trailing empty lines (e.g., code ending with \n) and handle CRLF
  {
    const expected = countLines(code)
    if (tokenLines.length < expected) {
      const pad = expected - tokenLines.length
      tokenLines = tokenLines.concat(Array.from({ length: pad }, () => []))
    }
  }
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
      const newLineEl = createLineElement(tokenLines[lastIdx], showLineNumbers, lineNumber, lineClass, ownerDocument, sig)
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
          const span = createLineElement(tokenLines[j], showLineNumbers, lineNumber, lineClass, ownerDocument, sig)
          frag.appendChild(span)
          ln++
        }
        codeEl.appendChild(frag)
      }
      ensureTokenStyleSheet(styleRoot)
      opts.onResult?.('incremental')
      LAST_CODE.set(container, code)
      return 'incremental'
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
        const newInner = lineInnerHtml(tokenLines[idx], showLineNumbers, lineNumber)
        if (oldLine.innerHTML !== newInner) {
          divergeAt = idx
          break
        }
        LINE_SIGNATURES.set(oldLine, sig)
      }
    }
    else {
      const newInner = lineInnerHtml(tokenLines[idx], showLineNumbers, lineNumber)
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
        const span = createLineElement(tokenLines[j], showLineNumbers, lineNumber, lineClass, ownerDocument, sig)
        frag.appendChild(span)
        ln++
      }
      codeEl.appendChild(frag)
      ensureTokenStyleSheet(styleRoot)
      opts.onResult?.('incremental')
      LAST_CODE.set(container, code)
      return 'incremental'
    }

    if (newLen < oldLen) {
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
        tokenStyleMode: 'class',
      })
      opts.onResult?.('full')
      LAST_CODE.set(container, code)
      return 'full'
    }

    ensureTokenStyleSheet(styleRoot)
    opts.onResult?.('noop')
    LAST_CODE.set(container, code)
    return 'noop'
  }

  // Divergence at or after last existing line -> update that line and append others
  if (divergeAt >= oldLen - 1) {
    const lineNumber = showLineNumbers ? (startingLineNumber + divergeAt) : undefined
    const sig = compareMode === 'signature' ? lineSignature(tokenLines[divergeAt], showLineNumbers, lineNumber) : undefined
    const newLineEl = createLineElement(tokenLines[divergeAt], showLineNumbers, lineNumber, lineClass, ownerDocument, sig)
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
        const span = createLineElement(tokenLines[j], showLineNumbers, lineNumber, lineClass, ownerDocument, sig)
        frag.appendChild(span)
        ln++
      }
      codeEl.appendChild(frag)
    }
    ensureTokenStyleSheet(styleRoot)
    opts.onResult?.('incremental')
    LAST_CODE.set(container, code)
    return 'incremental'
  }

  // Divergence earlier -> full replace for correctness
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
    tokenStyleMode: 'class',
  })
  opts.onResult?.('full')
  LAST_CODE.set(container, code)
  return 'full'
}

export interface TokenIncrementalUpdater {
  update: (code: string, tokenLines?: ThemedToken[][]) => UpdateResult
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
  let lastCode: string | null = null

  return {
    update: (code: string, tokenLines?: ThemedToken[][]) => {
      if (!alive)
        return 'noop'
      if (!target)
        return 'noop'
      const skipSame = tokenLines == null && opts.skipSameCode !== false
      if (skipSame && lastCode === code) {
        const codeEl = target.querySelector('code')
        if (codeEl && (codeEl.textContent ?? '').replace(/\r/g, '') === code.replace(/\r/g, '')) {
          ensureTokenStyleSheet(opts.styleRoot ?? target)
          opts.onResult?.('noop')
          return 'noop'
        }
      }
      const nextOpts = tokenLines ? { ...opts, tokenLines } : opts
      const res = updateCodeTokensIncremental(target, highlighter, code, nextOpts)
      lastCode = code
      return res
    },
    reset: () => {
      if (!alive || !target)
        return
      target.innerHTML = ''
      lastCode = null
    },
    dispose: () => {
      alive = false
      target = null
      lastCode = null
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

class TokenUpdateScheduler {
  private queue: ScheduledTask[] = []
  private byContainer = new WeakMap<HTMLElement, ScheduledTask>()
  private visible = new WeakMap<HTMLElement, boolean>()
  private io: IntersectionObserver | null = null
  private handle: any = null
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

  private ensureProcessing() {
    if (this.handle != null)
      return

    const win = this.queue[0]?.container.ownerDocument?.defaultView as any
    const ric = win?.requestIdleCallback
      ?? (globalThis as any).requestIdleCallback
      ?? function (cb: any) {
        return setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: true }), 50)
      }
    this.handle = ric.call(win ?? globalThis, (deadline: any) => this.process(deadline))
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
    this.handle = null
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
        if (typeof task.estNodes === 'number')
          nodesProcessed += task.estNodes
        else
          nodesProcessed += 50 // fallback conservative increment
      }
      catch {
        // On unexpected error, fall back to full replace and notify
        try {
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
            styleRoot: task.opts.styleRoot ?? task.container,
            tokenStyleMode: 'class',
          })
          LAST_CODE.set(task.container, task.code)
          task.opts.onResult?.('full')
        }
        catch {
          task.opts.onResult?.('noop')
        }
      }

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

  cancelFor(container: HTMLElement) {
    const prev = this.byContainer.get(container)
    if (prev) {
      this.byContainer.delete(container)
      const idx = this.queue.findIndex(t => t.id === prev.id)
      if (idx !== -1)
        this.queue.splice(idx, 1)
    }
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
  let scheduledTaskId: number | null = null
  let pendingCode: string | null = null
  let pendingTokenLines: ThemedToken[][] | undefined
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancelScheduledTask = () => {
    if (!container || scheduledTaskId == null)
      return
    globalTokenUpdateScheduler.cancelFor(container)
    scheduledTaskId = null
  }

  const flush = () => {
    timer = null
    if (!alive || !container || pendingCode == null)
      return

    const code = pendingCode
    const tokenLines = pendingTokenLines
    pendingCode = null
    pendingTokenLines = undefined

    let taskId = -1
    let completedSynchronously = false

    const updateOpts: TokenIncrementalOptions = {
      ...opts,
      appendOnlyFastPath: opts.appendOnlyFastPath ?? false,
      onResult: (result) => {
        completedSynchronously = true
        if (scheduledTaskId === taskId)
          scheduledTaskId = null
        opts.onResult?.(result)
      },
    }

    // Schedule the update; result will be delivered via opts.onResult when executed
    taskId = globalTokenUpdateScheduler.schedule(container, highlighter, code, updateOpts, tokenLines)
    if (!completedSynchronously)
      scheduledTaskId = taskId
  }

  const scheduleFlush = () => {
    const throttleMs = opts.throttleMs ?? 0
    if (throttleMs <= 0) {
      flush()
      return
    }
    if (!timer)
      timer = setTimeout(flush, throttleMs)
  }

  return {
    update: (code: string, tokenLines?: ThemedToken[][]) => {
      if (!alive)
        return 'noop'
      if (!container)
        return 'noop'

      cancelScheduledTask()
      pendingCode = code
      pendingTokenLines = tokenLines
      scheduleFlush()
      // Synchronous return is 'noop' since actual rendering will occur later
      return 'noop'
    },
    reset: () => {
      if (!alive || !container)
        return
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pendingCode = null
      pendingTokenLines = undefined
      cancelScheduledTask()
      container.innerHTML = ''
    },
    dispose: () => {
      alive = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pendingCode = null
      pendingTokenLines = undefined
      cancelScheduledTask()
      // leave container as-is; caller may remove
    },
  }
}
