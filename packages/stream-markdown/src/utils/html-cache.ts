import type { Highlighter } from 'shiki'

export interface HtmlCacheOptions {
  htmlCache?: boolean
  htmlCacheMaxEntries?: number
}

const DEFAULT_HTML_CACHE_SIZE = 30
const perHighlighterCache = new WeakMap<Highlighter, Map<string, string>>()

function getCache(highlighter: Highlighter) {
  let cache = perHighlighterCache.get(highlighter)
  if (!cache) {
    cache = new Map()
    perHighlighterCache.set(highlighter, cache)
  }
  return cache
}

function getLimit(opts?: HtmlCacheOptions) {
  return typeof opts?.htmlCacheMaxEntries === 'number'
    ? Math.max(0, Math.floor(opts.htmlCacheMaxEntries))
    : DEFAULT_HTML_CACHE_SIZE
}

export function getCachedHtml(
  highlighter: Highlighter,
  key: string,
  opts?: HtmlCacheOptions,
): string | undefined {
  const cacheEnabled = opts?.htmlCache !== false
  const limit = getLimit(opts)
  if (!cacheEnabled || limit <= 0)
    return undefined

  const cache = getCache(highlighter)
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
  }
  return cached
}

export function setCachedHtml(
  highlighter: Highlighter,
  key: string,
  html: string,
  opts?: HtmlCacheOptions,
) {
  const cacheEnabled = opts?.htmlCache !== false
  const limit = getLimit(opts)
  if (!cacheEnabled || limit <= 0)
    return

  const cache = getCache(highlighter)
  cache.set(key, html)
  if (cache.size > limit) {
    const firstKey = cache.keys().next().value as string | undefined
    if (firstKey !== undefined)
      cache.delete(firstKey)
  }
}
