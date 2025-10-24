import { registerHighlight } from './highlight.js'
import { createTokenIncrementalUpdater } from './incremental-tokens.js'

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

  const cancelFrame = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  const ensureHighlighter = async () => {
    highlighter = await registerHighlight({ langs: options.langs, themes: options.themes as any })
  }

  const reinitUpdater = () => {
    updater?.dispose()
    updater = createTokenIncrementalUpdater(container, highlighter, {
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
    scheduled = true
    rafId = requestAnimationFrame(() => {
      scheduled = false
      rafId = null
      if (!updater)
        return
      updater.update(currentCode)
    })
  }

  const updateCode = async (code: string, lang?: string) => {
    const nextLang = lang ?? currentLang
    const langChanged = nextLang !== currentLang
    currentCode = code

    if (!highlighter || langChanged) {
      currentLang = nextLang
      await ensureHighlighter()
      reinitUpdater()
    }
    else if (!updater) {
      reinitUpdater()
    }

    // Defer actual DOM/token updates to next animation frame to limit CPU
    // and batch multiple calls within the same frame.
    scheduleRender()
  }

  const setTheme = async (theme: string) => {
    if (theme && theme !== currentTheme) {
      currentTheme = theme
      // Make sure the target theme is loaded on the highlighter
      if (!highlighter)
        await ensureHighlighter()
      else
        highlighter.loadTheme(theme)
      reinitUpdater()
      // Theme change可以触发大量工作；根据配置选择rAF或立即应用，避免双重调度
      scheduleRender()
    }
  }

  const dispose = () => {
    updater?.dispose()
    updater = null
    disposed = true
    cancelFrame()
  }

  const getState = () => ({ code: currentCode, lang: currentLang, theme: currentTheme })

  return { updateCode, setTheme, dispose, getState }
}
