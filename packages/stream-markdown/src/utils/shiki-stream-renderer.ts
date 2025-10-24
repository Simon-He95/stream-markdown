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

  const ensureHighlighter = async () => {
    highlighter = await registerHighlight({ langs: options.langs, themes: options.themes as any })
  }

  const reinitUpdater = () => {
    updater?.dispose()
    updater = createTokenIncrementalUpdater(container, highlighter, {
      lang: currentLang,
      theme: currentTheme,
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

    updater!.update(currentCode)
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
      updater!.update(currentCode)
    }
  }

  const dispose = () => {
    updater?.dispose()
    updater = null
  }

  const getState = () => ({ code: currentCode, lang: currentLang, theme: currentTheme })

  return { updateCode, setTheme, dispose, getState }
}
