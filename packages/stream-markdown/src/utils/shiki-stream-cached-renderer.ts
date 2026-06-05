import type { createTokenIncrementalUpdater } from './incremental-tokens.js'
import type { ThemedToken } from './shiki-render.js'
import type { ShikiStreamRendererOptions } from './shiki-stream-renderer.js'
import { ShikiStreamTokenizer } from 'shiki-stream'
import { registerHighlight } from './highlight.js'
import { createScheduledTokenIncrementalUpdater } from './incremental-tokens.js'
import { scheduleRenderJob, setTimeBudget } from './render-scheduler.js'
import { observeElement } from './shared-intersection-observer.js'

export interface ShikiStreamCachedRendererOptions extends ShikiStreamRendererOptions {
  /**
   * If true (default), attempt to reuse Shiki grammar state for appended
   * content via shiki-stream. Set to false to always retokenize from scratch.
   */
  useGrammarState?: boolean
}

function tokensToLines(tokens: ThemedToken[]): ThemedToken[][] {
  const lines: ThemedToken[][] = [[]]
  for (const t of tokens) {
    if (t.content === '\n') {
      lines.push([])
      continue
    }
    lines[lines.length - 1].push(t)
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
  let updater: ReturnType<typeof createTokenIncrementalUpdater> | null = null
  const useRaf = options.scheduleInRaf ?? true
  let scheduled = false
  let pendingTokenLines: ThemedToken[][] | null = null
  let disposed = false
  let unregisterObserver: (() => void) | null = null
  let isVisible = false
  let opChain: Promise<unknown> = Promise.resolve()

  const ensureHighlighter = async () => {
    if (disposed)
      return
    highlighter = await registerHighlight({ langs: options.langs, themes: options.themes as any })
  }

  const ensureThemeLoaded = async (theme: string) => {
    if (!theme || disposed)
      return
    if (!highlighter)
      await ensureHighlighter()
    if (disposed || !highlighter)
      return
    const anyHl = highlighter as any
    if (typeof anyHl.loadTheme === 'function')
      await anyHl.loadTheme(theme)
  }

  const ensureTokenizer = async () => {
    if (!highlighter)
      await ensureHighlighter()
    if (disposed || !highlighter)
      return
    if (!tokenizer) {
      tokenizer = new ShikiStreamTokenizer({
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

  if (typeof window !== 'undefined' && container) {
    unregisterObserver = observeElement(container, (v) => {
      isVisible = v
    })
  }

  if (typeof options.timeBudget === 'number' && options.timeBudget >= 0)
    setTimeBudget(options.timeBudget)

  const reinitUpdater = () => {
    updater?.dispose()
    if (!highlighter)
      return
    updater = createScheduledTokenIncrementalUpdater(container, highlighter, {
      lang: currentLang ?? 'plaintext',
      theme: currentTheme,
      appendOnlyFastPath: options.appendOnlyFastPath ?? true,
      throttleMs: options.throttleMs,
    })
  }

  const scheduleRender = (tokenLines: ThemedToken[][]) => {
    if (disposed)
      return
    pendingTokenLines = tokenLines
    if (!useRaf) {
      if (!updater)
        return
      const lines = pendingTokenLines
      pendingTokenLines = null
      if (lines)
        updater.update(currentCode, lines)
      return
    }
    if (scheduled)
      return
    scheduled = true
    const priority = isVisible ? 'high' : 'normal'
    scheduleRenderJob(() => {
      scheduled = false
      if (!updater || !pendingTokenLines)
        return
      const lines = pendingTokenLines
      pendingTokenLines = null
      updater.update(currentCode, lines)
    }, { priority })
  }

  const updateCode = (code: string, lang?: string) => enqueue(async () => {
    if (disposed)
      return
    const nextLang = lang ?? currentLang
    const langChanged = nextLang !== currentLang
    const codeChanged = code !== currentCode

    if (!codeChanged && !langChanged)
      return

    const prevCode = currentCode
    currentCode = code

    if (!highlighter || langChanged) {
      currentLang = nextLang
      await ensureHighlighter()
      await ensureThemeLoaded(currentTheme)
      tokenizer = null
      tokenBuffer = []
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
      && tokenBuffer.length > 0
      && !!prevCode
      && code.startsWith(prevCode)
    if (!canAppend) {
      tokenizer.clear()
      tokenBuffer = []
    }

    const chunk = canAppend ? code.slice(prevCode.length) : code
    const { stable, unstable, recall } = await tokenizer.enqueue(chunk)
    if (disposed)
      return

    if (canAppend && recall > 0)
      tokenBuffer.splice(Math.max(0, tokenBuffer.length - recall))
    else if (!canAppend)
      tokenBuffer = []

    tokenBuffer.push(...(stable ?? []), ...(unstable ?? []))
    scheduleRender(tokensToLines(tokenBuffer))
  })

  const setTheme = (theme: string) => enqueue(async () => {
    if (disposed)
      return
    if (!theme || theme === currentTheme)
      return
    await ensureThemeLoaded(theme)
    if (disposed)
      return
    currentTheme = theme
    tokenizer?.clear()
    tokenizer = null
    tokenBuffer = []
    reinitUpdater()
    if (!currentCode)
      return
    await ensureTokenizer()
    const activeTokenizer = tokenizer as ShikiStreamTokenizer | null
    if (disposed || !activeTokenizer || !updater)
      return
    const { stable, unstable } = await activeTokenizer.enqueue(currentCode)
    if (disposed)
      return
    tokenBuffer = [...(stable ?? []), ...(unstable ?? [])]
    scheduleRender(tokensToLines(tokenBuffer))
  })

  const dispose = () => {
    disposed = true
    pendingTokenLines = null
    updater?.dispose()
    updater = null
    tokenizer?.clear()
    tokenizer = null
    tokenBuffer = []
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
