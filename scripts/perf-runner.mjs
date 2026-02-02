import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const runs = Number(process.env.PERF_RUNS ?? 3)
const port = Number(process.env.PERF_PORT ?? 3333)
const waitTimeout = Number(process.env.PERF_TIMEOUT ?? 60000)
const streamBlocks = Number(process.env.PERF_STREAM_BLOCKS ?? 8)
const streamRepeat = Number(process.env.PERF_STREAM_REPEAT ?? 4)
const streamChunk = Number(process.env.PERF_STREAM_CHUNK ?? 64)
const streamDelay = Number(process.env.PERF_STREAM_DELAY ?? 0)
const fullBlocks = Number(process.env.PERF_FULL_BLOCKS ?? 40)
const fullRepeat = Number(process.env.PERF_FULL_REPEAT ?? 6)
const fullTokenCache = process.env.PERF_FULL_TOKEN_CACHE !== '0'
const fullHtmlCache = process.env.PERF_FULL_HTML_CACHE !== '0'
const htmlCacheMax = Number(process.env.PERF_HTML_CACHE_MAX ?? 30)
const tokenCacheMax = Number(process.env.PERF_TOKEN_CACHE_MAX ?? 50)

function summarize(list) {
  const cpu = list.map(r => r.cpuMs)
  const paint = list.map(r => r.paintMs)
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length
  return {
    runs: list.length,
    avgCpuMs: avg(cpu),
    avgPaintMs: avg(paint),
    minCpuMs: Math.min(...cpu),
    maxCpuMs: Math.max(...cpu),
    minPaintMs: Math.min(...paint),
    maxPaintMs: Math.max(...paint),
  }
}

function printSummary(label, summary) {
  console.log(`\n${label}`)
  console.log(`  runs: ${summary.runs}`)
  console.log(`  cpu avg/min/max: ${summary.avgCpuMs.toFixed(2)} / ${summary.minCpuMs.toFixed(2)} / ${summary.maxCpuMs.toFixed(2)} ms`)
  console.log(`  paint avg/min/max: ${summary.avgPaintMs.toFixed(2)} / ${summary.minPaintMs.toFixed(2)} / ${summary.maxPaintMs.toFixed(2)} ms`)
}

function printDelta(base, next, label) {
  const pct = (b, n) => ((b - n) / b) * 100
  console.log(`\nDelta (${label})`)
  console.log(`  cpu: ${pct(base.avgCpuMs, next.avgCpuMs).toFixed(1)}%`)
  console.log(`  paint: ${pct(base.avgPaintMs, next.avgPaintMs).toFixed(1)}%`)
}

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port, strictPort: true },
  logLevel: 'error',
})

let browser
try {
  await server.listen()
  const url = `http://localhost:${port}/perf`
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__streamMarkdownPerf?.isReady?.(), { timeout: waitTimeout })

  const baseConfig = {
    streamBlockCount: streamBlocks,
    streamRepeatCount: streamRepeat,
    streamChunkSize: streamChunk,
    streamDelayMs: streamDelay,
  }

  async function runStream(mode, useCache) {
    await page.evaluate((cfg) => {
      window.__streamMarkdownPerf.setConfig(cfg)
    }, { ...baseConfig, streamCompareMode: mode, streamTokenCache: useCache })

    const list = []
    for (let i = 0; i < runs; i++) {
      const res = await page.evaluate(() => window.__streamMarkdownPerf.runStreamRender())
      list.push(res)
    }
    return summarize(list)
  }

  async function runFull({ tokenCache, htmlCache }) {
    await page.evaluate((cfg) => {
      window.__streamMarkdownPerf.setConfig(cfg)
    }, {
      blockCount: fullBlocks,
      repeatCount: fullRepeat,
      tokenCache,
      tokenCacheMaxEntries: tokenCacheMax,
      htmlCache,
      htmlCacheMaxEntries: htmlCacheMax,
    })
    const list = []
    for (let i = 0; i < runs; i++) {
      const res = await page.evaluate(() => window.__streamMarkdownPerf.runFullRender())
      list.push(res)
    }
    return summarize(list)
  }

  const fullNoCache = await runFull({ tokenCache: false, htmlCache: false })
  printSummary('Full render tokenCache=off htmlCache=off', fullNoCache)

  if (fullHtmlCache) {
    const fullHtml = await runFull({ tokenCache: false, htmlCache: true })
    printSummary('Full render tokenCache=off htmlCache=on', fullHtml)
    printDelta(fullNoCache, fullHtml, 'htmlCache off -> on (tokenCache off)')
  }

  if (fullTokenCache) {
    const fullToken = await runFull({ tokenCache: true, htmlCache: false })
    printSummary('Full render tokenCache=on htmlCache=off', fullToken)
    printDelta(fullNoCache, fullToken, 'tokenCache off -> on (htmlCache off)')
  }

  if (fullTokenCache && fullHtmlCache) {
    const fullTokenHtml = await runFull({ tokenCache: true, htmlCache: true })
    printSummary('Full render tokenCache=on htmlCache=on', fullTokenHtml)
    printDelta(fullNoCache, fullTokenHtml, 'tokenCache+htmlCache off -> on')
  }

  const innerNoCache = await runStream('innerHTML', false)
  const sigNoCache = await runStream('signature', false)
  const sigCache = await runStream('signature', true)

  printSummary('Stream compareMode=innerHTML tokenCache=off', innerNoCache)
  printSummary('Stream compareMode=signature tokenCache=off', sigNoCache)
  printSummary('Stream compareMode=signature tokenCache=on', sigCache)
  printDelta(innerNoCache, sigNoCache, 'innerHTML -> signature (no cache)')
  printDelta(sigNoCache, sigCache, 'tokenCache off -> on (signature)')
}
finally {
  if (browser)
    await browser.close()
  await server.close()
}
