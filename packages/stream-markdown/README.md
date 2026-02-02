# stream-markdown

Streaming code/markdown rendering utilities built on Shiki.

## Install (monorepo)

This repo links it via pnpm workspaces. For external usage:

```sh
pnpm add stream-markdown shiki
```

> 文档语言: [English](./README.md) | [中文](./README.zh-CN.md)

## API

- registerHighlight(options?): Ensure a shared Shiki highlighter with given langs/themes is available.
- renderCodeWithTokens(highlighter, code, opts): Render <pre><code> HTML with .line spans from tokens. `opts.tokenCache` / `opts.tokenCacheMaxEntries` control token caching; `opts.htmlCache` / `opts.htmlCacheMaxEntries` control full HTML caching.
- updateCodeTokensIncremental(container, highlighter, code, opts): Incrementally update DOM with tokens; falls back to full render on divergence. `opts.compareMode` can be `'signature'` (default) or `'innerHTML'`. `opts.tokenCache` / `opts.tokenCacheMaxEntries` control token caching; `opts.htmlCache` / `opts.htmlCacheMaxEntries` control full HTML caching.
- createTokenIncrementalUpdater(container, highlighter, opts): Factory returning { update, reset, dispose } optimized for streaming.
- createScheduledTokenIncrementalUpdater(container, highlighter, opts): Like `createTokenIncrementalUpdater` but defers DOM/token updates to idle time and prioritizes visible containers. `update(code)` is asynchronous (returns synchronously with 'noop'); final result is reported via `opts.onResult` when the scheduled task runs.

Example (observe final result via onResult):

```ts
import { createHighlighter } from 'shiki'
import { createScheduledTokenIncrementalUpdater } from 'stream-markdown'

const highlighter = await createHighlighter({ themes: ['vitesse-dark'], langs: ['typescript'] })
const container = document.getElementById('code')!

const updater = createScheduledTokenIncrementalUpdater(container, highlighter, {
  lang: 'typescript',
  theme: 'vitesse-dark',
  onResult: result => console.log('scheduled render finished:', result),
})

// Synchronous return from update() is 'noop' for scheduled updater; rely on onResult
updater.update('const a = 1')
updater.update('const a = 12')
```

Note: use the immediate `createTokenIncrementalUpdater` where a synchronous UpdateResult is required (tests or callers that depend on immediate DOM changes).
- createShikiStreamRenderer(container, { lang, theme, themes? }): Facade exposing updateCode(code, lang?) and setTheme(theme), handling reinit/dispose internally. Optional `themes` pre-registers all themes you plan to switch between.

## Quick start

```ts
import { createShikiStreamRenderer, registerHighlight } from 'stream-markdown'

const container = document.getElementById('out')!
// Preload languages and themes you plan to use (optional; renderer can also lazy-load)
await registerHighlight({ langs: ['typescript'], themes: ['vitesse-dark', 'vitesse-light'] })
const renderer = createShikiStreamRenderer(container, {
  lang: 'typescript',
  theme: 'vitesse-dark',
  themes: ['vitesse-dark', 'vitesse-light'],
})

let code = ''
for (const ch of source) {
  code += ch
  await renderer.updateCode(code)
}

// Later, switch theme without reloading the page
await renderer.setTheme('vitesse-light')
```

## Notes
- CRLF is normalized so DOM textContent matches the source.
- Theme and language modules are loaded on demand; pass `themes` to pre-register all candidates and avoid a first-use delay.

## Rendering scheduler and restore helper

When restoring many code blocks or otherwise scheduling large numbers of
render updates, the library provides a small scheduler and a restore helper
to avoid freezing the main thread:

- `setTimeBudget(ms)` / `getTimeBudget()` — tune how many ms per frame the
  shared scheduler will spend running render jobs (default 8ms).
- `pause()` / `resume()` — temporarily pause the scheduler while you perform
  critical setup work.
- `drain()` — run all queued jobs synchronously (use sparingly; may block the
  main thread).
- `getQueueLength()` — inspect pending jobs.
- `restoreWithVisibilityPriority(items, opts)` — helper to schedule a batch of
  restores where items in the viewport are scheduled with high priority and
  offscreen items are staggered in small batches. Options include `batchSize`,
  `staggerMs`, and `drainVisible` to optionally force visible items to finish
  synchronously.

Example:

```ts
import { restoreWithVisibilityPriority, setTimeBudget } from 'stream-markdown'

setTimeBudget(6)

const items = blocks.map(b => ({ el: b.container, render: () => renderer.updateCode(b.code) }))
restoreWithVisibilityPriority(items, { batchSize: 8, staggerMs: 40 })
```
