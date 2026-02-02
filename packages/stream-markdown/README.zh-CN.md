# stream-markdown（中文）

基于 Shiki 的流式语法高亮与 Markdown 渲染工具集，支持按 token 自绘与增量更新，适合“逐字符/逐块”流式输出场景。

[English](./README.md) · [NPM](https://www.npmjs.com/package/stream-markdown)

## 安装

```sh
pnpm add stream-markdown shiki
```

## API 概览

- `registerHighlight(options?)`：确保共享的 Shiki 高亮器已就绪；可按需加载 `langs` 与 `themes`。
- `renderCodeWithTokens(highlighter, code, opts)`：将 tokens 渲染为 `<pre><code>` HTML（每行 `.line`）。`opts.tokenCache` / `opts.tokenCacheMaxEntries` 控制 token 缓存；`opts.htmlCache` / `opts.htmlCacheMaxEntries` 控制完整 HTML 缓存。
- `updateCodeTokensIncremental(container, highlighter, code, opts)`：基于 tokens 的增量更新；若发现早前行出现分歧会回退到全量渲染。`opts.compareMode` 可选 `'signature'`（默认）或 `'innerHTML'`。`opts.tokenCache` / `opts.tokenCacheMaxEntries` 控制 token 缓存；`opts.htmlCache` / `opts.htmlCacheMaxEntries` 控制完整 HTML 缓存。
- `createTokenIncrementalUpdater(container, highlighter, opts)`：工厂返回 `{ update, reset, dispose }`，用于高性能流式渲染。
- `createScheduledTokenIncrementalUpdater(container, highlighter, opts)`：功能类似于 `createTokenIncrementalUpdater`，但会把 DOM / token 更新延迟到空闲时间执行，并优先渲染可见容器。注意 `update(code)` 为异步路径——同步返回 'noop'，最终结果会通过 `opts.onResult` 回调通知。

示例（通过 onResult 观察最终渲染结果）：

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

// 注意：scheduled updater 的 update() 同步返回 'noop'；请通过 onResult 获取最终状态
updater.update('const a = 1')
updater.update('const a = 12')
```

提示：如果调用方需要同步的 UpdateResult（例如测试或依赖即时 DOM 更改的代码），请继续使用 `createTokenIncrementalUpdater`。
- `createShikiStreamRenderer(container, { lang, theme, themes? })`：高阶门面；提供 `updateCode(code, lang?)` 与 `setTheme(theme)`，内部处理高亮器注册与增量更新器生命周期。`themes` 用于预注册所有主题。

## 快速开始（推荐）

```ts
import { createShikiStreamRenderer, registerHighlight } from 'stream-markdown'

// 可选：预先加载语言与主题
await registerHighlight({ langs: ['typescript'], themes: ['vitesse-dark', 'vitesse-light'] })

const container = document.getElementById('out')!
const renderer = createShikiStreamRenderer(container, {
  lang: 'typescript',
  theme: 'vitesse-dark',
  themes: ['vitesse-dark', 'vitesse-light'],
})

let code = ''
for (const ch of 'const a = 1\nconst b = 2\n') {
  code += ch
  await renderer.updateCode(code)
}

await renderer.setTheme('vitesse-light')
```

## 直接使用底层增量更新器

```ts
import { createHighlighter } from 'shiki'
import { createTokenIncrementalUpdater } from 'stream-markdown'

const highlighter = await createHighlighter({ langs: ['ts'], themes: ['vitesse-dark'] })
const container = document.getElementById('code')!
const updater = createTokenIncrementalUpdater(container, highlighter, { lang: 'ts', theme: 'vitesse-dark' })

updater.update('let x = 1')
updater.update('let x = 12')
```

## 提示

- 预注册主题：将全部候选主题传入 `themes`，或先 `registerHighlight({ themes: [...] })`，可以避免首次切换时的延迟或丢主题。
- CRLF 归一化：内部会处理 CRLF，使 DOM 的 `textContent` 与源文本完全一致。
- 结构约定：每一行对应 `.line`，空行也会有 `.line`，便于行号/选择/复制操作。

## 渲染调度器与恢复助手

当需要恢复大量 code block 或同时调度大量高亮更新时，库提供一个调度器与恢复助手来避免主线程被一次性占满：

- `setTimeBudget(ms)` / `getTimeBudget()` — 调整共享调度器每帧用于处理渲染任务的时间（默认 8ms）。
- `pause()` / `resume()` — 暂停或恢复调度器（暂停时任务仍保留在队列中）。
- `drain()` — 立即同步运行所有队列任务（会绕过每帧预算，请谨慎使用）。
- `getQueueLength()` — 获取当前队列长度，便于调试和观察。
- `restoreWithVisibilityPriority(items, opts)` — 恢复辅助函数，优先渲染可见项，后台项目分批延迟执行；常用参数包括 `batchSize`、`staggerMs`、`drainVisible`。

示例使用见：`USAGE_RENDER_SCHEDULER.zh-CN.md`。你也可以在 demo 页面实时调整 `timeBudget` 以观察效果。

## 许可

MIT
