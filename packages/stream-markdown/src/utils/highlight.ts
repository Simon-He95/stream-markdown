import type { BundledTheme, Highlighter, SpecialTheme, ThemeInput } from 'shiki'
import { bumpHighlighterRevision, clearHighlighterRevision } from './highlighter-revision.js'
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
let highlighterGeneration = 0

function isCurrentHighlighterInstance(instance: Highlighter, generation: number): boolean {
  return highlighterGeneration === generation && highlighter === instance
}

function getThemeId(theme: HighlightTheme): string | undefined {
  if (typeof theme === 'string')
    return theme

  const name = (theme as any)?.name
  return typeof name === 'string' ? name : undefined
}

function isThemeObject(theme: HighlightTheme): theme is HighlightTheme & object {
  return !!theme && typeof theme === 'object'
}

function isThemeLoaded(theme: HighlightTheme): boolean {
  return typeof theme === 'string' && loadedBundledThemes.has(theme)
}

function markThemeLoaded(theme: HighlightTheme): void {
  if (typeof theme === 'string') {
    loadedBundledThemes.add(theme)
    return
  }

  if (!isThemeObject(theme))
    return

  const id = getThemeId(theme)
  if (id)
    loadedBundledThemes.delete(id)
}

function markInitialLoaded(langs: string[], themes: HighlightTheme[]) {
  for (const lang of langs)
    loadedLangs.add(lang)

  for (const theme of themes)
    markThemeLoaded(theme)
}

function removeInitiallyLoadedPendingThemes(themes: HighlightTheme[]) {
  const stringThemes = new Set<string>()
  const objectThemes = new Set<object>()

  for (const theme of themes) {
    if (typeof theme === 'string') {
      stringThemes.add(theme)
      continue
    }

    if (isThemeObject(theme))
      objectThemes.add(theme)
  }

  pendingThemes = pendingThemes.filter((theme) => {
    if (typeof theme === 'string')
      return !stringThemes.has(theme)

    return !(isThemeObject(theme) && objectThemes.has(theme))
  })
}

function addPendingLangs(langs: string[]) {
  for (const l of langs) {
    if (!loadedLangs.has(l))
      pendingLangs.add(l)
  }
}

function findPendingThemeIndexById(id: string): number {
  return pendingThemes.findIndex(theme => getThemeId(theme) === id)
}

function hasPendingThemeObject(theme: object): boolean {
  return pendingThemes.includes(theme as HighlightTheme)
}

function addPendingThemes(themes: HighlightTheme[]) {
  for (const theme of themes) {
    const id = getThemeId(theme)

    if (id) {
      const existingIndex = findPendingThemeIndexById(id)
      if (existingIndex !== -1) {
        pendingThemes[existingIndex] = theme
        continue
      }
    }
    else if (isThemeObject(theme) && hasPendingThemeObject(theme)) {
      continue
    }

    if (isThemeLoaded(theme))
      continue

    pendingThemes.push(theme)
  }
}

function requeuePendingThemes(themes: HighlightTheme[]) {
  for (const theme of themes) {
    if (isThemeLoaded(theme))
      continue

    const id = getThemeId(theme)
    if (id && findPendingThemeIndexById(id) !== -1)
      continue
    if (!id && isThemeObject(theme) && hasPendingThemeObject(theme))
      continue

    pendingThemes.push(theme)
  }
}

async function loadPendingIntoHighlighter(
  targetHighlighter: Highlighter,
  generation: number,
): Promise<void> {
  if (!isCurrentHighlighterInstance(targetHighlighter, generation))
    return

  const anyHl = targetHighlighter as any
  const langs = Array.from(pendingLangs).filter(l => !loadedLangs.has(l))
  const themes = pendingThemes.filter(t => !isThemeLoaded(t))
  pendingLangs.clear()
  pendingThemes = []

  let didMutateHighlighter = false
  let langIndex = 0
  let themeIndex = 0

  try {
    if (langs.length > 0 && typeof anyHl.loadLanguage === 'function') {
      for (; langIndex < langs.length; langIndex++) {
        const l = langs[langIndex]
        if (loadedLangs.has(l))
          continue

        await anyHl.loadLanguage(l)
        if (!isCurrentHighlighterInstance(targetHighlighter, generation))
          return

        loadedLangs.add(l)
        didMutateHighlighter = true
      }
    }
    if (themes.length > 0 && typeof anyHl.loadTheme === 'function') {
      for (; themeIndex < themes.length; themeIndex++) {
        const t = themes[themeIndex]
        if (isThemeLoaded(t))
          continue

        await anyHl.loadTheme(t)
        if (!isCurrentHighlighterInstance(targetHighlighter, generation))
          return

        markThemeLoaded(t)
        didMutateHighlighter = true
      }
    }
  }
  catch (error) {
    if (!isCurrentHighlighterInstance(targetHighlighter, generation))
      return

    for (const l of langs.slice(langIndex)) {
      if (!loadedLangs.has(l))
        pendingLangs.add(l)
    }

    requeuePendingThemes(themes.slice(themeIndex))
    throw error
  }
  finally {
    if (didMutateHighlighter && isCurrentHighlighterInstance(targetHighlighter, generation)) {
      bumpHighlighterRevision(targetHighlighter)
      clearTokenCache(targetHighlighter)
      clearHtmlCache(targetHighlighter)
    }
  }
}

async function applyPending(targetHighlighter: Highlighter, generation = highlighterGeneration) {
  // Serialize loads to avoid overlapping loadTheme/loadLanguage on the same instance.
  const run = applyPromise
    .catch(() => undefined)
    .then(() => {
      if (!isCurrentHighlighterInstance(targetHighlighter, generation))
        return
      return loadPendingIntoHighlighter(targetHighlighter, generation)
    })

  applyPromise = run.catch(() => undefined)

  return run
}

export async function registerHighlight(options: {
  themes?: HighlightTheme[]
  langs?: string[]
} = {}) {
  const langs = (!options.langs || options.langs.length === 0) ? defaultLanguages : options.langs
  const themes = (!options.themes || options.themes.length === 0) ? defaultThemes : options.themes

  addPendingLangs(langs)
  addPendingThemes(themes)
  const requestGeneration = highlighterGeneration

  if (highlighter) {
    const activeHighlighter = highlighter
    await applyPending(activeHighlighter, requestGeneration)

    if (requestGeneration !== highlighterGeneration || highlighter !== activeHighlighter)
      return registerHighlight(options)

    return activeHighlighter
  }

  // If a creation is already in progress, wait for it. Otherwise, create a
  // single promise immediately (wrapping the dynamic import + creation) so
  // concurrent callers don't each import and create their own highlighter.
  if (!highlighterPromise) {
    const creationGeneration = highlighterGeneration
    const promise = (async () => {
      const { createHighlighter } = await import('shiki')
      const initialThemes = pendingThemes.length > 0 ? pendingThemes.slice() : defaultThemes
      const initialLangs = pendingLangs.size > 0 ? Array.from(pendingLangs) : defaultLanguages
      const h = await createHighlighter({
        themes: initialThemes,
        langs: initialLangs,
      })
      if (creationGeneration !== highlighterGeneration)
        return h

      markInitialLoaded(initialLangs, initialThemes)
      for (const lang of initialLangs)
        pendingLangs.delete(lang)
      removeInitiallyLoadedPendingThemes(initialThemes)
      highlighter = h
      await applyPending(h, creationGeneration)
      return h
    })()
    const trackedPromise = promise.finally(() => {
      // Clear the promise reference when done so future calls can create a
      // new highlighter if `disposeHighlighter` was used.
      if (highlighterPromise === trackedPromise)
        highlighterPromise = null
    })
    highlighterPromise = trackedPromise
  }

  const h = await highlighterPromise
  if (requestGeneration !== highlighterGeneration)
    return h

  await applyPending(h, requestGeneration)

  if (requestGeneration !== highlighterGeneration || highlighter !== h)
    return registerHighlight(options)

  return h
}

export function disposeHighlighter() {
  highlighterGeneration++
  if (highlighter) {
    clearHighlighterRevision(highlighter)
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
