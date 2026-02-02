import type { Highlighter } from 'shiki'
import type { RenderOptions, ThemedToken } from './shiki-render.js'
import { renderCodeWithTokens } from './shiki-render.js'
import { getTokenLines } from './token-cache.js'

export type UpdateResult = 'incremental' | 'full' | 'noop'

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
const LINE_SIGNATURES = new WeakMap<HTMLElement, string>()
const LAST_CODE = new WeakMap<HTMLElement, string>()
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

function lineInnerHtml(tokens: ThemedToken[], showLineNumbers: boolean, lineNumber?: number): string {
  const tokensHtml = tokens.map((t) => {
    const style = tokenStyle(t.color, t.fontStyle)
    const styleAttr = style ? ` style="${style}"` : ''
    return `<span${styleAttr}>${escapeHtml(t.content)}</span>`
  }).join('')
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
    const style = tokenStyle(t.color, t.fontStyle)
    let content = t.content
    i++

    while (i < tokens.length) {
      const t2 = tokens[i]
      const style2 = tokenStyle(t2.color, t2.fontStyle)
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
 * with identical inline style strings to reduce node count.
 */
function createLineElement(tokens: ThemedToken[], showLineNumbers: boolean, lineNumber: number | undefined, lineClass: string, signature?: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = lineClass
  if (signature)
    LINE_SIGNATURES.set(span, signature)

  if (showLineNumbers && typeof lineNumber === 'number') {
    const ln = document.createElement('span')
    ln.className = 'line-number'
    ln.dataset.line = String(lineNumber)
    span.appendChild(ln)
  }

  // Merge adjacent tokens with identical style string to reduce DOM nodes
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    const style = tokenStyle(t.color, t.fontStyle)
    let content = t.content
    i++

    while (i < tokens.length) {
      const t2 = tokens[i]
      const style2 = tokenStyle(t2.color, t2.fontStyle)
      if (style2 !== style)
        break
      content += t2.content
      i++
    }

    const tspan = document.createElement('span')
    if (style)
      tspan.setAttribute('style', style)
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
   * Default false to preserve correctness for multiline-token grammars.
   */
  appendOnlyFastPath?: boolean
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
  const compareMode = opts.compareMode ?? 'signature'

  // Ensure initial structure
  const codeEl = container.querySelector('code') as HTMLElement | null
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
    })
    opts.onResult?.('full')
    LAST_CODE.set(container, code)
    return 'full'
  }

  const oldLines = codeEl.getElementsByClassName(lineClass) as HTMLCollectionOf<HTMLElement>
  let tokenLines = getTokenLines(highlighter, code, lang, theme, {
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
      const newLineEl = createLineElement(tokenLines[lastIdx], showLineNumbers, lineNumber, lineClass, sig)
      oldLines[lastIdx].innerHTML = ''
      while (newLineEl.firstChild)
        oldLines[lastIdx].appendChild(newLineEl.firstChild)
      if (sig)
        LINE_SIGNATURES.set(oldLines[lastIdx], sig)

      if (newLen > oldLen) {
        const frag = document.createDocumentFragment()
        let ln = startingLineNumber + oldLen
        for (let j = oldLen; j < newLen; j++) {
          frag.appendChild(document.createTextNode('\n'))
          const lineNumber = showLineNumbers ? ln : undefined
          const sig = compareMode === 'signature'
            ? lineSignature(tokenLines[j], showLineNumbers, lineNumber)
            : undefined
          const span = createLineElement(tokenLines[j], showLineNumbers, lineNumber, lineClass, sig)
          frag.appendChild(span)
          ln++
        }
        codeEl.appendChild(frag)
      }
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
      const frag = document.createDocumentFragment()
      let ln = startingLineNumber + oldLen
      for (let j = oldLen; j < newLen; j++) {
        // Insert a newline separator before each appended line to match Shiki's codeToHtml
        frag.appendChild(document.createTextNode('\n'))
        const lineNumber = showLineNumbers ? ln : undefined
        const sig = compareMode === 'signature' ? lineSignature(tokenLines[j], showLineNumbers, lineNumber) : undefined
        const span = createLineElement(tokenLines[j], showLineNumbers, lineNumber, lineClass, sig)
        frag.appendChild(span)
        ln++
      }
      codeEl.appendChild(frag)
      opts.onResult?.('incremental')
      LAST_CODE.set(container, code)
      return 'incremental'
    }
    opts.onResult?.('noop')
    LAST_CODE.set(container, code)
    return 'noop'
  }

  // Divergence at or after last existing line -> update that line and append others
  if (divergeAt >= oldLen - 1) {
    const lineNumber = showLineNumbers ? (startingLineNumber + divergeAt) : undefined
    const sig = compareMode === 'signature' ? lineSignature(tokenLines[divergeAt], showLineNumbers, lineNumber) : undefined
    const newLineEl = createLineElement(tokenLines[divergeAt], showLineNumbers, lineNumber, lineClass, sig)
    // Replace children of the existing line element with the newly built nodes
    oldLines[divergeAt].innerHTML = ''
    while (newLineEl.firstChild)
      oldLines[divergeAt].appendChild(newLineEl.firstChild)
    if (sig)
      LINE_SIGNATURES.set(oldLines[divergeAt], sig)

    if (newLen > oldLen) {
      const frag = document.createDocumentFragment()
      let ln = startingLineNumber + oldLen
      for (let j = oldLen; j < newLen; j++) {
        // Maintain newline separators between .line spans to match codeToHtml
        frag.appendChild(document.createTextNode('\n'))
        const lineNumber = showLineNumbers ? ln : undefined
        const sig = compareMode === 'signature' ? lineSignature(tokenLines[j], showLineNumbers, lineNumber) : undefined
        const span = createLineElement(tokenLines[j], showLineNumbers, lineNumber, lineClass, sig)
        frag.appendChild(span)
        ln++
      }
      codeEl.appendChild(frag)
    }
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
  })
  opts.onResult?.('full')
  LAST_CODE.set(container, code)
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
  let lastCode: string | null = null

  return {
    update: (code: string) => {
      if (!alive)
        return 'noop'
      if (!target)
        return 'noop'
      const skipSame = opts.skipSameCode !== false
      if (skipSame && lastCode === code) {
        const codeEl = target.querySelector('code')
        if (codeEl && (codeEl.textContent ?? '').replace(/\r/g, '') === code.replace(/\r/g, '')) {
          opts.onResult?.('noop')
          return 'noop'
        }
      }
      const res = updateCodeTokensIncremental(target, highlighter, code, opts)
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

  schedule(container: HTMLElement, highlighter: Highlighter, code: string, opts: TokenIncrementalOptions) {
    // Deduplicate: if a task already exists for this container, replace its payload
    const prev = this.byContainer.get(container)
    if (prev) {
      prev.code = code
      prev.highlighter = highlighter
      prev.opts = opts
      return prev.id
    }

    const task: ScheduledTask = { id: this.nextId++, container, highlighter, code, opts }
    // Cheap heuristic for node cost to avoid double tokenization here:
    // - base on line count and code length (tokens roughly scale with length)
    // This is only used to decide whether to defer a large task to next tick.
    {
      const lineCount = countLines(code)
      // assume ~1 token span per ~6 chars on average
      const estTokenSpans = Math.ceil(code.length / 6)
      task.estNodes = Math.min(8000, lineCount + estTokenSpans)
    }
    this.queue.push(task)
    this.byContainer.set(container, task)
    if (this.io)
      this.io.observe(container)

    this.ensureProcessing()
    return task.id
  }

  private ensureProcessing() {
    if (this.handle != null)
      return

    const ric = (window as any).requestIdleCallback || function (cb: any) {
      return setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: true }), 50)
    }
    this.handle = ric((deadline: any) => this.process(deadline))
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
        const res = updateCodeTokensIncremental(task.container, task.highlighter, task.code, task.opts)
        task.opts.onResult?.(res)
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
          })
          task.opts.onResult?.('full')
        }
        catch {
          task.opts.onResult?.('noop')
        }
      }

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
    if (!prev)
      return
    this.byContainer.delete(container)
    const idx = this.queue.findIndex(t => t.id === prev.id)
    if (idx !== -1)
      this.queue.splice(idx, 1)
    if (this.io)
      this.io.unobserve(container)
    this.visible.delete(container)
  }
}

const globalTokenUpdateScheduler = new TokenUpdateScheduler()

export function createScheduledTokenIncrementalUpdater(
  container: HTMLElement | null | undefined,
  highlighter: Highlighter,
  opts: TokenIncrementalOptions,
): TokenIncrementalUpdater {
  let alive = true
  let observed = false

  return {
    update: (code: string) => {
      if (!alive)
        return 'noop'
      if (!container)
        return 'noop'

      // Schedule the update; result will be delivered via opts.onResult when executed
      globalTokenUpdateScheduler.schedule(container, highlighter, code, opts)
      observed = true
      // Synchronous return is 'noop' since actual rendering will occur later
      return 'noop'
    },
    reset: () => {
      if (!alive || !container)
        return
      globalTokenUpdateScheduler.cancelFor(container)
      container.innerHTML = ''
    },
    dispose: () => {
      alive = false
      if (observed && container)
        globalTokenUpdateScheduler.cancelFor(container)
      // leave container as-is; caller may remove
    },
  }
}
