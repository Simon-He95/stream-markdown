import type { createTokenIncrementalUpdater } from './incremental-tokens.js'
import { registerHighlight } from './highlight.js'
import { createScheduledTokenIncrementalUpdater } from './incremental-tokens.js'
import { scheduleRenderJob, setTimeBudget } from './render-scheduler.js'
import { observeElement } from './shared-intersection-observer.js'

export interface ShikiStreamRendererOptions {
  // initial language
  lang?: string
  // all languages that might be used later; pre-register to enable seamless switching
  langs?: string[]
  // initial theme
  theme?: string
  // all themes that might be used later; pre-register to enable seamless switching
  // accepts theme names or ThemeInput objects
  themes?: any[]
  // whether to coalesce updateCode into requestAnimationFrame at renderer layer
  // default: true
  scheduleInRaf?: boolean
  // optional per-renderer suggestion for scheduler time budget (ms). If set,
  // this will call setTimeBudget() which affects the shared scheduler.
  timeBudget?: number
}

export function createShikiStreamRenderer(
  container: HTMLElement,
  options: ShikiStreamRendererOptions,
) {
  let currentCode = ''
  let currentLang = options.lang
  let currentTheme = options.theme ?? 'vitesse-dark'
  let highlighter: any | null = null
  let updater: ReturnType<typeof createTokenIncrementalUpdater> | null = null
  // Coalesce frequent updateCode calls into a single rAF-driven update to
  // avoid re-tokenizing on every keystream chunk.
  const useRaf = options.scheduleInRaf ?? true
  let scheduled = false
  let rafId: number | null = null
  let disposed = false
  let unregisterObserver: (() => void) | null = null
  let isVisible = false
  // Serialize updateCode/setTheme to avoid races between theme/language loads
  // and tokenization work (e.g. theme load promise not finished but render starts).
  let opChain: Promise<unknown> = Promise.resolve()

  const cancelFrame = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

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
    if (typeof anyHl.loadTheme === 'function') {
      // Always await: shiki.loadTheme is async and tokenization may throw if
      // the theme is referenced before it's registered.
      await anyHl.loadTheme(theme)
    }
  }

  const enqueue = <T>(task: () => Promise<T>) => {
    const next = opChain.then(task, task)
    // Keep the chain alive even if callers don't handle rejection.
    opChain = next.then(() => undefined, () => undefined)
    return next
  }

  // Use a shared IntersectionObserver helper when available to track visibility
  // without creating many observers. We register loosely (best-effort).
  if (typeof window !== 'undefined' && container) {
    unregisterObserver = observeElement(container, (v) => {
      isVisible = v
    })
  }

  // If a per-renderer timeBudget is provided, set the shared scheduler budget.
  if (typeof options.timeBudget === 'number' && options.timeBudget >= 0) {
    setTimeBudget(options.timeBudget)
  }

  const reinitUpdater = () => {
    updater?.dispose()
    // prefer scheduled (deferred) updater to avoid blocking when many renderers
    // update at once. Falls back to immediate updater if needed elsewhere.
    updater = createScheduledTokenIncrementalUpdater(container, highlighter, {
      lang: currentLang ?? 'plaintext',
      theme: currentTheme,
    })
  }

  const scheduleRender = () => {
    if (disposed)
      return
    if (scheduled)
      return
    if (!useRaf) {
      // Immediate apply when rAF scheduling is disabled (e.g., caller batches externally)
      if (!updater)
        return
      updater.update(currentCode)
      return
    }
    // Use shared scheduler to avoid multiple renderers all running heavy
    // updates in the same frame. We schedule a small job that runs updater.update.
    if (scheduled)
      return
    scheduled = true

    // Prefer visible containers to reduce perceived jank: if the container is
    // currently visible in the viewport (tracked by IntersectionObserver),
    // schedule with high priority so it runs earlier than offscreen renderers.
    const priority = isVisible ? 'high' : 'normal'
    scheduleRenderJob(() => {
      scheduled = false
      if (!updater)
        return
      updater.update(currentCode)
    }, { priority })
    rafId = null
  }

  const updateCode = (code: string, lang?: string) => enqueue(async () => {
    if (disposed)
      return
    const nextLang = lang ?? currentLang
    const langChanged = nextLang !== currentLang
    currentCode = code

    if (!highlighter || langChanged) {
      currentLang = nextLang
      await ensureHighlighter()
      await ensureThemeLoaded(currentTheme)
      reinitUpdater()
    }
    else if (!updater) {
      reinitUpdater()
    }

    // Defer actual DOM/token updates to next animation frame to limit CPU
    // and batch multiple calls within the same frame.
    scheduleRender()
  })

  const setTheme = (theme: string) => enqueue(async () => {
    if (disposed)
      return
    if (!theme || theme === currentTheme)
      return
    // Make sure the target theme is loaded on the highlighter before switching.
    await ensureThemeLoaded(theme)
    if (disposed)
      return
    currentTheme = theme
    reinitUpdater()
    // Theme change可以触发大量工作；根据配置选择rAF或立即应用，避免双重调度
    scheduleRender()
  })

  const dispose = () => {
    updater?.dispose()
    updater = null
    if (unregisterObserver) {
      unregisterObserver()
      unregisterObserver = null
    }
    disposed = true
    cancelFrame()
  }

  const getState = () => ({ code: currentCode, lang: currentLang, theme: currentTheme })

  return { updateCode, setTheme, dispose, getState }
}
