import type { Highlighter } from 'shiki'

const highlighterRevisions = new WeakMap<Highlighter, number>()

export function getHighlighterRevision(highlighter: Highlighter): number {
  return highlighterRevisions.get(highlighter) ?? 0
}

export function bumpHighlighterRevision(highlighter: Highlighter): number {
  const next = getHighlighterRevision(highlighter) + 1
  highlighterRevisions.set(highlighter, next)
  return next
}

export function clearHighlighterRevision(highlighter: Highlighter): void {
  highlighterRevisions.delete(highlighter)
}
