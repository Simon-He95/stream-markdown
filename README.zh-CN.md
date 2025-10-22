# 流式语法高亮（增量渲染）

本项目提供基于 Shiki 的“增量渲染”方案，支持在代码/Markdown 流式输出时高亮，仅更新变动行，必要时回退到安全的全量重绘。

[![NPM version](https://img.shields.io/npm/v/stream-markdown?color=a1b858&label=)](https://www.npmjs.com/package/stream-markdown)
[![English Docs](https://img.shields.io/badge/docs-English-blue)](README.md)
[![NPM downloads](https://img.shields.io/npm/dm/stream-markdown)](https://www.npmjs.com/package/stream-markdown)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/stream-markdown)](https://bundlephobia.com/package/stream-markdown)
[![License](https://img.shields.io/npm/l/stream-markdown)](./LICENSE)

## 核心能力

- Token 自绘：将 Shiki 的 token 渲染为 `<pre><code>` 结构，每一行都是 `.line`，便于后续增量对比与更新。
- 增量更新：仅更新“最后一行”或追加新行；若早前行出现差异（如跨行 token），自动回退到全量重绘以保持正确性。
- 主题/语言动态切换：支持在不中断渲染的情况下切换主题与语言，可预注册所有候选主题以避免首次切换的加载延迟。

## 安装

```sh
pnpm add stream-markdown shiki
```

## 快速开始（推荐高阶封装）

使用高阶封装 `createShikiStreamRenderer`，它会处理高亮器的注册、增量更新器的生命周期，以及主题/语言切换。

```ts
import { createShikiStreamRenderer } from 'stream-markdown'

const container = document.getElementById('out')!

// 可选：预加载所有可能会用到的主题，切换更顺滑
const themes = ['vitesse-dark', 'vitesse-light', 'one-dark-pro']

const renderer = createShikiStreamRenderer(container, {
  lang: 'typescript',
  theme: 'vitesse-dark',
  themes, // 预注册，避免首次切换时延迟
})

let code = ''
const source = 'const msg: string = "hello"\nconsole.log(msg)\n'
for (const ch of source) {
  code += ch
  await renderer.updateCode(code)
}

// 任意时刻切换主题
await renderer.setTheme('vitesse-light')
```

在 Demo 页面中，我们提供了主题下拉框（使用 Shiki 的 `bundledThemesInfo` 生成），可一键切换所有内置主题。

## 直接使用底层增量 API（可选）

如果你需要完全控制渲染流程，可直接使用 token 增量更新器：

```ts
import { createHighlighter } from 'shiki'
import { createTokenIncrementalUpdater } from 'stream-markdown'

const highlighter = await createHighlighter({
  langs: ['typescript'],
  themes: ['vitesse-dark'],
})

const container = document.getElementById('code')!
const updater = createTokenIncrementalUpdater(container, highlighter, {
  lang: 'typescript',
  theme: 'vitesse-dark',
})

updater.update('const a = 1')
updater.update('const a = 12')
```

- 当新增行时，组件会在相邻行之间插入换行文本节点，保持 `textContent` 与源文本一致（包含 CRLF 归一化）。
- 如检测到较早行不一致，会回退到一次性的全量重绘，确保结构正确（空行对应 `.line`）。

## 注意事项

- 主题切换建议预注册：将所有可能会用到的主题通过 `themes` 传入 `createShikiStreamRenderer`，或先调用 `registerHighlight({ themes: [...] })`，避免首次切换时的延迟或主题缺失。
- CRLF 归一化：为保证 DOM 与源文本一致，渲染前会做 CRLF 处理。
- 结构约定：每一行都是一个 `.line` 容器；相邻行之间使用换行文本节点拼接，便于 `textContent` 直接对齐源文本。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Simon-He95/stream-markdown&type=Date)](https://www.star-history.com/#Simon-He95/stream-markdown&Date)

## License

[MIT](./LICENSE) © [Simon He](https://github.com/Simon-He95)
