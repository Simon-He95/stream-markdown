import type { BundledTheme, Highlighter, SpecialTheme, ThemeInput } from 'shiki'
import { clearHtmlCache } from './html-cache.js'
import { clearTokenCache } from './token-cache.js'

type HighlightTheme = BundledTheme | SpecialTheme | ThemeInput

export const defaultLanguages = [
  'jsx',
  'tsx',
  'vue',
  'csharp',
  'python',
  'java',
  'c',
  'cpp',
  'rust',
  'go',
  'powershell',
  'sql',
  'json',
  'html',
  'javascript',
  'typescript',
  'css',
  'markdown',
  'xml',
  'yaml',
  'toml',
  'dockerfile',
  'kotlin',
  'objective-c',
  'objective-cpp',
  'php',
  'ruby',
  'scala',
  'svelte',
  'swift',
  'erlang',
  'angular-html',
  'angular-ts',
  'dart',
  'lua',
  'mermaid',
  'cmake',
  'nginx',
]
export const defaultThemes: BundledTheme[] = ['vitesse-dark', 'vitesse-light']
let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
const pendingLangs = new Set<string>()
let pendingThemes: HighlightTheme[] = []
const loadedLangs = new Set<string>()
const loadedBundledThemes = new Set<string>()
let applyPromise: Promise<void> = Promise.resolve()

function getThemeId(theme: HighlightTheme): string | undefined {
  if (typeof theme === 'string')
    return theme

  const name = (theme as any)?.name
  return typeof name === 'string' ? name : undefined
}

function markInitialLoaded(langs: string[], themes: HighlightTheme[]) {
  for (const lang of langs)
    loadedLangs.add(lang)

  for (const theme of themes) {
    if (typeof theme === 'string')
      loadedBundledThemes.add(theme)
  }
}

function removeInitiallyLoadedPendingThemes(themes: HighlightTheme[]) {
  const stringThemes = new Set<string>()
  const objectThemes = new Set<object>()
  const objectThemeIds = new Set<string>()

  for (const theme of themes) {
    if (typeof theme === 'string') {
      stringThemes.add(theme)
      continue
    }

    if (theme && typeof theme === 'object') {
      objectThemes.add(theme)
      const id = getThemeId(theme)
      if (id)
        objectThemeIds.add(id)
    }
  }

  pendingThemes = pendingThemes.filter((theme) => {
    if (typeof theme === 'string')
      return !stringThemes.has(theme)

    if (theme && typeof theme === 'object') {
      if (objectThemes.has(theme))
        return false

      const id = getThemeId(theme)
      return !id || !objectThemeIds.has(id)
    }

    return true
  })
}

function addPendingLangs(langs: string[]) {
  for (const l of langs) {
    if (!loadedLangs.has(l))
      pendingLangs.add(l)
  }
}

function addPendingThemes(themes: HighlightTheme[]) {
  const pendingIds = new Set<string>()
  for (const t of pendingThemes) {
    const id = getThemeId(t)
    if (id)
      pendingIds.add(id)
  }

  for (const t of themes) {
    if (typeof t === 'string') {
      if (!loadedBundledThemes.has(t) && !pendingIds.has(t)) {
        pendingIds.add(t)
        pendingThemes.push(t)
      }
    }
    else {
      const id = getThemeId(t)
      if (id) {
        if (!pendingIds.has(id)) {
          pendingIds.add(id)
          pendingThemes.push(t)
        }
      }
      else {
        pendingThemes.push(t)
      }
    }
  }
}

async function applyPending(highlighter: Highlighter) {
  // Serialize loads to avoid overlapping loadTheme/loadLanguage on the same instance.
  applyPromise = applyPromise.then(async () => {
    const anyHl = highlighter as any
    const langs = Array.from(pendingLangs).filter(l => !loadedLangs.has(l))
    const themes = pendingThemes.filter(t => typeof t !== 'string' || !loadedBundledThemes.has(t))
    pendingLangs.clear()
    pendingThemes = []
    let didMutateHighlighter = false

    if (langs.length > 0 && typeof anyHl.loadLanguage === 'function') {
      for (const l of langs) {
        await anyHl.loadLanguage(l)
        loadedLangs.add(l)
        didMutateHighlighter = true
      }
    }
    if (themes.length > 0 && typeof anyHl.loadTheme === 'function') {
      for (const t of themes) {
        await anyHl.loadTheme(t)
        if (typeof t === 'string')
          loadedBundledThemes.add(t)
        didMutateHighlighter = true
      }
    }

    if (didMutateHighlighter) {
      clearTokenCache(highlighter)
      clearHtmlCache(highlighter)
    }
  })
  return applyPromise
}

export async function registerHighlight(options: {
  themes?: HighlightTheme[]
  langs?: string[]
} = {}) {
  const langs = (!options.langs || options.langs.length === 0) ? defaultLanguages : options.langs
  const themes = (!options.themes || options.themes.length === 0) ? defaultThemes : options.themes

  addPendingLangs(langs)
  addPendingThemes(themes)

  if (highlighter) {
    await applyPending(highlighter)
    return highlighter
  }
  // If a creation is already in progress, wait for it. Otherwise, create a
  // single promise immediately (wrapping the dynamic import + creation) so
  // concurrent callers don't each import and create their own highlighter.
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import('shiki')
      const initialThemes = pendingThemes.length > 0 ? pendingThemes.slice() : defaultThemes
      const initialLangs = pendingLangs.size > 0 ? Array.from(pendingLangs) : defaultLanguages
      const h = await createHighlighter({
        themes: initialThemes,
        langs: initialLangs,
      })
      markInitialLoaded(initialLangs, initialThemes)
      for (const lang of initialLangs)
        pendingLangs.delete(lang)
      removeInitiallyLoadedPendingThemes(initialThemes)
      highlighter = h
      await applyPending(h)
      return h
    })().finally(() => {
      // Clear the promise reference when done so future calls can create a
      // new highlighter if `disposeHighlighter` was used.
      highlighterPromise = null
    })
  }

  const h = await highlighterPromise
  await applyPending(h)
  return h
}

export function disposeHighlighter() {
  if (highlighter) {
    clearTokenCache(highlighter)
    clearHtmlCache(highlighter)
  }
  highlighter = null
  highlighterPromise = null
  pendingLangs.clear()
  pendingThemes = []
  loadedLangs.clear()
  loadedBundledThemes.clear()
  applyPromise = Promise.resolve()
}
