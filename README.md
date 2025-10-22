## Streamed syntax highlighting (incremental)

This project includes a lightweight, framework-agnostic incremental renderer for Shiki:

- `src/utils/shiki-render.ts` – render `<pre><code>` HTML with each line wrapped in `.line`
- `src/utils/incremental-tokens.ts` – token-based incremental updater (no HTML parsing)

[![NPM version](https://img.shields.io/npm/v/stream-markdown?color=a1b858&label=)](https://www.npmjs.com/package/stream-markdown)
[![中文版](https://img.shields.io/badge/docs-中文文档-blue)](README.zh-CN.md)
[![NPM downloads](https://img.shields.io/npm/dm/stream-markdown)](https://www.npmjs.com/package/stream-markdown)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/stream-markdown)](https://bundlephobia.com/package/stream-markdown)
[![License](https://img.shields.io/npm/l/stream-markdown)](./LICENSE)

Basic usage (token-based):

```ts
import { createHighlighter } from 'shiki'
import { createTokenIncrementalUpdater } from './src/utils/incremental-tokens'

const highlighter = await createHighlighter({ themes: ['vitesse-dark'], langs: ['typescript'] })
const container = document.getElementById('code')!

const updater = createTokenIncrementalUpdater(container, highlighter, {
  lang: 'typescript',
  theme: 'vitesse-dark',
})

// Stream in more source text over time
updater.update('const a = 1')
updater.update('const a = 12')
```

It incrementally updates the last changed line and appends new lines; if earlier lines diverge (e.g. multi-line tokens), it safely falls back to a full re-render.

## Thanks

This project is built with the help of these awesome libraries:

- [shiki](https://github.com/shikijs/shiki) — Syntax highlighter powered by TextMate grammars and VS Code themes

Thanks to the authors and contributors of these projects!

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Simon-He95/stream-markdown&type=Date)](https://www.star-history.com/#Simon-He95/stream-markdown&Date)

## License

[MIT](./LICENSE) © [Simon He](https://github.com/Simon-He95)
