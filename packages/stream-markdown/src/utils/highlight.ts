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

export async function registerHighlight(options: {
  themes?: ThemeInput[] | SpecialTheme[]
  langs?: string[]
} = {}) {
  if (highlighter) {
    return highlighter
  }

  if (highlighterPromise) {
    await highlighterPromise
    // After initial creation, attempt to load any additional themes/langs
    return registerHighlight(options)
  }

  const { createHighlighter } = await import('shiki')
  if (!options.langs || options.langs.length === 0)
    options.langs = defaultLanguages
  if (!options.themes || options.themes.length === 0)
    options.themes = defaultThemes as any

  highlighterPromise = createHighlighter({ themes: options.themes as any, langs: options.langs })
    .then((h) => {
      highlighter = h
      return h
    })
    .finally(() => {
      highlighterPromise = null
    })

  return highlighterPromise
}

export function disposeHighlighter() {
  highlighter = null
}
