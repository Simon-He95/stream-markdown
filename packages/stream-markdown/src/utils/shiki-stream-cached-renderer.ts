import type { ShikiStreamTokenizer } from 'shiki-stream'
import type { TokenIncrementalOptions, TokenIncrementalUpdater } from './incremental-tokens.js'
import type { ThemedToken } from './shiki-render.js'
import type { ShikiStreamRendererOptions as BaseShikiStreamRendererOptions } from './shiki-stream-renderer.js'
import { defaultLanguages, registerHighlight } from './highlight.js'
import { getHighlighterRevision } from './highlighter-revision.js'
import { createScheduledTokenIncrementalUpdater, createTokenIncrementalUpdater } from './incremental-tokens.js'
import { scheduleRenderJob, setTimeBudget } from './render-scheduler.js'
import { observeElement } from './shared-intersection-observer.js'

export interface ShikiStreamCachedRendererOptions extends Omit<BaseShikiStreamRendererOptions, 'appendOnlyFastPath'> {
  /**
   * If true (default), attempt to reuse Shiki grammar state for appended
   * content via shiki-stream. Set to false to always retokenize from scratch.
   */
  useGrammarState?: boolean
}

type ShikiStreamTokenizerConstructor = typeof import('shiki-stream')['ShikiStreamTokenizer']

let shikiStreamTokenizerConstructorPromise: Promise<ShikiStreamTokenizerConstructor> | null = null

function loadShikiStreamTokenizerConstructor(): Promise<ShikiStreamTokenizerConstructor> {
  shikiStreamTokenizerConstructorPromise ??= import('shiki-stream')
    .then(mod => mod.ShikiStreamTokenizer)
  return shikiStreamTokenizerConstructorPromise
}

function tokensToLines(tokens: ThemedToken[]): ThemedToken[][] {
  const lines: ThemedToken[][] = [[]]
  let pendingCR = false

  const appendContent = (token: ThemedToken, content: string) => {
    if (!content)
      return

    lines[lines.length - 1].push(
      content === token.content ? token : { ...token, content },
    )
  }

  for (const token of tokens) {
    let content = token.content
    if (!content)
      continue

    // Previous token ended with \r. Treat the current leading \n as the LF part
    // of a CRLF pair; otherwise drop the lone \r to match the renderer's CR
    // normalization.
    if (pendingCR) {
      pendingCR = false

      if (content.charCodeAt(0) === 10) {
        lines.push([])
        content = content.slice(1)

        if (!content)
          continue
      }
    }

    let start = 0

    for (let i = 0; i < content.length; i++) {
      const ch = content.charCodeAt(i)

      if (ch !== 10 && ch !== 13)
        continue

      appendContent(token, content.slice(start, i))

      if (ch === 13) {
        // CRLF inside the same token.
        if (i + 1 < content.length && content.charCodeAt(i + 1) === 10) {
          lines.push([])
          i++
        }
        // CR at token boundary. Wait for the next token to see whether it starts
        // with LF.
        else if (i === content.length - 1) {
          pendingCR = true
        }
        // Lone CR in the middle of a token is dropped, consistent with escapeHtml.

        start = i + 1
        continue
      }

      // LF.
      lines.push([])
      start = i + 1
    }

    appendContent(token, content.slice(start))
  }

  return lines
}

/**
 * Renderer that reuses shiki-stream's tokenizer (grammarState-aware) to avoid
 * re-tokenizing stable prefixes when code arrives incrementally.
 *
 * API mirrors createShikiStreamRenderer: updateCode(lang?), setTheme, dispose.
 */
export function createShikiStreamCachedRenderer(
  container: HTMLElement,
  options: ShikiStreamCachedRendererOptions,
) {
  let currentCode = ''
  let currentLang = options.lang
  let currentTheme = options.theme ?? 'vitesse-dark'
  let highlighter: any | null = null
  let tokenizer: ShikiStreamTokenizer | null = null
  let tokenBuffer: ThemedToken[] = []
  let tokenBufferRevision = -1
  let updater: TokenIncrementalUpdater | null = null
  const useRaf = options.scheduleInRaf ?? true
  let scheduled = false
  let cancelScheduledRender: (() => void) | null = null
  let renderJobSeq = 0
  let pendingRender: { code: string, tokenLines?: ThemedToken[][] } | null = null
  let disposed = false
  let unregisterObserver: (() => void) | null = null
  let isVisible = false
  let opChain: Promise<unknown> = Promise.resolve()

  const getHighlightLangs = (lang = currentLang): string[] | undefined => {
    const optionLangs = options.langs?.length ? options.langs : undefined
    const baseLangs = optionLangs ?? defaultLanguages

    if (!lang || lang === 'plaintext' || baseLangs.includes(lang))
      return optionLangs

    return [...baseLangs, lang]
  }

  const ensureHighlighter = async (lang = currentLang) => {
    if (disposed)
      return
    const nextHighlighter = await registerHighlight({ langs: getHighlightLangs(lang), themes: options.themes as any })
    if (disposed)
      return
    highlighter = nextHighlighter
  }

  const hasLoadedTheme = (theme: string) => {
    if (!highlighter)
      return false

    const anyHl = highlighter as any
    if (typeof anyHl.getTheme !== 'function')
      return false

    try {
      return !!anyHl.getTheme(theme)
    }
    catch {
      return false
    }
  }

  const ensureThemeLoaded = async (theme: string, lang = currentLang) => {
    if (!theme || disposed)
      return
    if (!highlighter)
      await ensureHighlighter(lang)
    if (disposed || !highlighter)
      return
    if (hasLoadedTheme(theme))
      return

    const nextHighlighter = await registerHighlight({ langs: getHighlightLangs(lang), themes: [theme as any] })
    if (!disposed)
      highlighter = nextHighlighter
  }

  const ensureTokenizer = async () => {
    if (!highlighter)
      await ensureHighlighter(currentLang)
    if (disposed || !highlighter)
      return
    if (!tokenizer) {
      const Tokenizer = await loadShikiStreamTokenizerConstructor()
      if (disposed || !highlighter)
        return

      tokenizer = new Tokenizer({
        highlighter,
        lang: currentLang ?? 'plaintext',
        theme: currentTheme,
      })
    }
  }

  const enqueue = <T>(task: () => Promise<T>) => {
    const next = opChain.then(task, task)
    opChain = next.then(() => undefined, () => undefined)
    return next
  }

  const getCurrentHighlighterRevision = () => {
    return highlighter ? getHighlighterRevision(highlighter) : -1
  }

  const clearTokenBuffer = () => {
    tokenBuffer = []
    tokenBufferRevision = getCurrentHighlighterRevision()
  }

  const cancelPendingRender = () => {
    renderJobSeq++
    if (cancelScheduledRender) {
      cancelScheduledRender()
      cancelScheduledRender = null
    }
    scheduled = false
    pendingRender = null
    updater?.cancel?.()
  }

  const scheduleCancelableRenderJob = (job: () => void, priority: 'high' | 'normal') => {
    const seq = ++renderJobSeq
    let ranSynchronously = false
    const cancel = scheduleRenderJob(() => {
      if (renderJobSeq !== seq)
        return
      ranSynchronously = true
      cancelScheduledRender = null
      job()
    }, { priority })

    if (renderJobSeq === seq)
      cancelScheduledRender = ranSynchronously ? null : cancel
  }

  if (typeof window !== 'undefined' && container) {
    unregisterObserver = observeElement(container, (v) => {
      isVisible = v
    })
  }

  if (typeof options.timeBudget === 'number' && Number.isFinite(options.timeBudget) && options.timeBudget >= 0)
    setTimeBudget(options.timeBudget)

  const getUpdaterOptions = (): TokenIncrementalOptions => ({
    lang: currentLang ?? 'plaintext',
    theme: currentTheme,
    preClass: options.preClass,
    codeClass: options.codeClass,
    lineClass: options.lineClass,
    showLineNumbers: options.showLineNumbers,
    startingLineNumber: options.startingLineNumber,
    tokenCache: options.tokenCache,
    tokenCacheMaxEntries: options.tokenCacheMaxEntries,
    htmlCache: options.htmlCache,
    htmlCacheMaxEntries: options.htmlCacheMaxEntries,
    styleRoot: options.styleRoot,
    tokenStyleMode: options.tokenStyleMode,
    compareMode: options.compareMode,
    skipSameCode: options.skipSameCode,
    // shiki-stream can recall and rewrite tokens before the previous last line,
    // so this renderer intentionally never exposes the append-only fast path.
    appendOnlyFastPath: false,
    throttleMs: options.throttleMs,
    onResult: options.onResult,
  })

  const reinitUpdater = () => {
    updater?.dispose()
    if (disposed || !highlighter)
      return

    const createUpdater = useRaf ? createScheduledTokenIncrementalUpdater : createTokenIncrementalUpdater
    updater = createUpdater(container, highlighter, getUpdaterOptions())
  }

  const scheduleRender = (code: string, tokenLines?: ThemedToken[][]) => {
    if (disposed)
      return
    pendingRender = { code, tokenLines }
    if (!useRaf) {
      if (!updater)
        return
      const render = pendingRender
      pendingRender = null
      if (render)
        updater.update(render.code, render.tokenLines)
      return
    }
    if (scheduled)
      return
    scheduled = true
    const priority = isVisible ? 'high' : 'normal'
    scheduleCancelableRenderJob(() => {
      scheduled = false
      if (disposed || !updater || !pendingRender)
        return
      const render = pendingRender
      pendingRender = null
      updater.update(render.code, render.tokenLines)
    }, priority)
  }

  const normalizeCodeText = (value: string) => value.replace(/\r/g, '')

  const getBufferedCodeText = () => {
    let text = ''
    for (const token of tokenBuffer)
      text += token.content
    return text
  }

  const bufferedTokensMatchCode = (code: string) => {
    if (!highlighter || tokenBufferRevision !== getHighlighterRevision(highlighter))
      return false

    return normalizeCodeText(getBufferedCodeText()) === normalizeCodeText(code)
  }

  const scheduleBufferedRender = (code: string) => {
    if (!bufferedTokensMatchCode(code)) {
      clearTokenBuffer()
      scheduleRender(code)
      return
    }

    scheduleRender(code, tokensToLines(tokenBuffer))
  }

  const updateCode = (code: string, lang?: string) => enqueue(async () => {
    if (disposed)
      return
    const nextLang = lang ?? currentLang
    const langChanged = nextLang !== currentLang
    const codeChanged = code !== currentCode

    // Same-code updates are only safe to short-circuit after the updater has
    // been initialized. A fresh renderer with updateCode('') still needs to
    // bootstrap the highlighter/updater and render an empty code block.
    if (!codeChanged && !langChanged && updater) {
      cancelPendingRender()
      scheduleBufferedRender(code)
      return
    }

    const prevCode = currentCode
    currentCode = code

    cancelPendingRender()

    if (!highlighter || langChanged) {
      currentLang = nextLang
      await ensureHighlighter(nextLang)
      await ensureThemeLoaded(currentTheme, nextLang)
      if (disposed)
        return
      tokenizer = null
      clearTokenBuffer()
      reinitUpdater()
    }
    else if (!updater) {
      reinitUpdater()
    }

    await ensureTokenizer()
    if (disposed || !tokenizer || !updater)
      return

    const canAppend = !langChanged
      && options.useGrammarState !== false
      && bufferedTokensMatchCode(prevCode)
      && !!prevCode
      && code.startsWith(prevCode)
    if (!canAppend) {
      tokenizer.clear()
      clearTokenBuffer()
    }

    const chunk = canAppend ? code.slice(prevCode.length) : code
    const { stable, unstable, recall } = await tokenizer.enqueue(chunk)
    if (disposed)
      return

    if (canAppend && recall > 0)
      tokenBuffer.splice(Math.max(0, tokenBuffer.length - recall))
    else if (!canAppend)
      clearTokenBuffer()

    tokenBuffer.push(...(stable ?? []), ...(unstable ?? []))
    tokenBufferRevision = getCurrentHighlighterRevision()
    scheduleBufferedRender(code)
  })

  const setTheme = (theme: string) => enqueue(async () => {
    if (disposed)
      return
    if (!theme || theme === currentTheme)
      return
    cancelPendingRender()
    await ensureThemeLoaded(theme, currentLang)
    if (disposed)
      return
    currentTheme = theme
    tokenizer?.clear()
    tokenizer = null
    clearTokenBuffer()
    reinitUpdater()

    // Empty code is still renderable state. Without this, clearing code and then
    // switching theme leaves the old rendered shell/background in the DOM.
    if (!currentCode) {
      scheduleBufferedRender(currentCode)
      return
    }

    await ensureTokenizer()
    const activeTokenizer = tokenizer as ShikiStreamTokenizer | null
    if (disposed || !activeTokenizer || !updater)
      return
    const { stable, unstable } = await activeTokenizer.enqueue(currentCode)
    if (disposed)
      return
    tokenBuffer = [...(stable ?? []), ...(unstable ?? [])]
    tokenBufferRevision = getCurrentHighlighterRevision()
    scheduleBufferedRender(currentCode)
  })

  const dispose = () => {
    disposed = true
    cancelPendingRender()
    updater?.dispose()
    updater = null
    tokenizer?.clear()
    tokenizer = null
    tokenBuffer = []
    tokenBufferRevision = -1
    if (unregisterObserver) {
      unregisterObserver()
      unregisterObserver = null
    }
  }

  const getState = () => ({
    code: currentCode,
    lang: currentLang,
    theme: currentTheme,
    tokenCount: tokenBuffer.length,
  })

  return {
    updateCode,
    setTheme,
    dispose,
    getState,
  }
}
