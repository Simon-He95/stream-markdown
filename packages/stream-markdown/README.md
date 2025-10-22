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
- renderCodeWithTokens(highlighter, code, opts): Render <pre><code> HTML with .line spans from tokens.
- updateCodeTokensIncremental(container, highlighter, code, opts): Incrementally update DOM with tokens; falls back to full render on divergence.
- createTokenIncrementalUpdater(container, highlighter, opts): Factory returning { update, reset, dispose } optimized for streaming.
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
