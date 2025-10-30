import type { Highlighter, SpecialTheme, ThemeInput } from 'shiki'
import { bundledLanguagesInfo } from 'shiki'

export const defaultLanguages = bundledLanguagesInfo.map(info => info.id)
export const defaultThemes = ['vitesse-dark', 'vitesse-light']
let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null

export async function registerHighlight(options: {
  themes?: ThemeInput[] | SpecialTheme[]
  langs?: string[]
} = {}) {
  if (highlighter) {
    return highlighter
  }
  // If a creation is already in progress, wait for it. Otherwise, create a
  // single promise immediately (wrapping the dynamic import + creation) so
  // concurrent callers don't each import and create their own highlighter.
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import('shiki')
      if (!options.langs || options.langs.length === 0)
        options.langs = defaultLanguages
      if (!options.themes || options.themes.length === 0)
        options.themes = defaultThemes as any

      const h = await createHighlighter({ themes: options.themes as any, langs: options.langs })
      highlighter = h
      return h
    })().finally(() => {
      // Clear the promise reference when done so future calls can create a
      // new highlighter if `disposeHighlighter` was used.
      highlighterPromise = null
    })
  }

  await highlighterPromise
  return highlighter!
}

export function disposeHighlighter() {
  highlighter = null
}
