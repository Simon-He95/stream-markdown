import type { Highlighter, SpecialTheme, ThemeInput } from 'shiki'

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
export const defaultThemes = ['vitesse-dark', 'vitesse-light']
let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
const pendingLangs = new Set<string>()
let pendingThemes: Array<ThemeInput | SpecialTheme> = []
let applyPromise: Promise<void> = Promise.resolve()

function addPendingLangs(langs: string[]) {
  for (const l of langs)
    pendingLangs.add(l)
}

function addPendingThemes(themes: Array<ThemeInput | SpecialTheme>) {
  // Best-effort dedupe by id/name for common cases; keep unknown objects as-is.
  const existingIds = new Set<string>()
  for (const t of pendingThemes) {
    if (typeof t === 'string')
      existingIds.add(t)
    else if (t && typeof (t as any).name === 'string')
      existingIds.add((t as any).name)
  }

  for (const t of themes) {
    if (typeof t === 'string') {
      if (!existingIds.has(t)) {
        existingIds.add(t)
        pendingThemes.push(t)
      }
    }
    else if (t && typeof (t as any).name === 'string') {
      const id = (t as any).name as string
      if (!existingIds.has(id)) {
        existingIds.add(id)
        pendingThemes.push(t)
      }
    }
    else {
      pendingThemes.push(t)
    }
  }
}

async function applyPending(highlighter: Highlighter) {
  // Serialize loads to avoid overlapping loadTheme/loadLanguage on the same instance.
  applyPromise = applyPromise.then(async () => {
    const anyHl = highlighter as any
    const langs = Array.from(pendingLangs)
    const themes = pendingThemes.slice()
    pendingLangs.clear()
    pendingThemes = []

    if (langs.length > 0 && typeof anyHl.loadLanguage === 'function') {
      for (const l of langs)
        await anyHl.loadLanguage(l)
    }
    if (themes.length > 0 && typeof anyHl.loadTheme === 'function') {
      for (const t of themes)
        await anyHl.loadTheme(t)
    }
  })
  return applyPromise
}

export async function registerHighlight(options: {
  themes?: ThemeInput[] | SpecialTheme[]
  langs?: string[]
} = {}) {
  const langs = (!options.langs || options.langs.length === 0) ? defaultLanguages : options.langs
  const themes = (!options.themes || options.themes.length === 0) ? (defaultThemes as any) : options.themes

  addPendingLangs(langs)
  addPendingThemes(themes as any)

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
      const h = await createHighlighter({
        themes: pendingThemes.length > 0 ? (pendingThemes as any) : (defaultThemes as any),
        langs: pendingLangs.size > 0 ? Array.from(pendingLangs) : defaultLanguages,
      })
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
  highlighter = null
  highlighterPromise = null
  pendingLangs.clear()
  pendingThemes = []
  applyPromise = Promise.resolve()
}
