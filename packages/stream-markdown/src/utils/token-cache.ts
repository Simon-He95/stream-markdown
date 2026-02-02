import type { Highlighter } from 'shiki'
import type { ThemedToken } from './shiki-render.js'

export interface TokenCacheOptions {
  tokenCache?: boolean
  tokenCacheMaxEntries?: number
}

const DEFAULT_TOKEN_CACHE_SIZE = 50
const perHighlighterCache = new WeakMap<Highlighter, Map<string, ThemedToken[][]>>()

function getCache(highlighter: Highlighter) {
  let cache = perHighlighterCache.get(highlighter)
  if (!cache) {
    cache = new Map()
    perHighlighterCache.set(highlighter, cache)
  }
  return cache
}

export function getTokenLines(
  highlighter: Highlighter,
  code: string,
  lang: string,
  theme: string,
  opts?: TokenCacheOptions,
): ThemedToken[][] {
  const cacheEnabled = opts?.tokenCache !== false
  const limit = typeof opts?.tokenCacheMaxEntries === 'number'
    ? Math.max(0, Math.floor(opts.tokenCacheMaxEntries))
    : DEFAULT_TOKEN_CACHE_SIZE

  const anyHl = highlighter as any
  const getTokens = () => {
    if (typeof anyHl.codeToThemedTokens === 'function')
      return anyHl.codeToThemedTokens(code, lang, theme) as ThemedToken[][]
    if (typeof anyHl.codeToTokens === 'function') {
      const r = anyHl.codeToTokens(code, { lang, theme })
      return r.tokens as ThemedToken[][]
    }
    throw new TypeError('Highlighter does not support token APIs: codeToThemedTokens/codeToTokens')
  }

  if (!cacheEnabled || limit <= 0)
    return getTokens()

  const cache = getCache(highlighter)
  const key = `${lang}\u0001${theme}\u0001${code}`
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const tokens = getTokens()
  cache.set(key, tokens)
  if (cache.size > limit) {
    const firstKey = cache.keys().next().value as string | undefined
    if (firstKey !== undefined)
      cache.delete(firstKey)
  }
  return tokens
}
