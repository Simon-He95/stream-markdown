<script setup lang="ts">
import { registerHighlight, renderCodeWithTokens, updateCodeTokensIncremental } from 'stream-markdown'
import { onMounted, onUnmounted, ref } from 'vue'
import { typescriptContent } from './markdown'

const lang = 'typescript'
const theme = 'vitesse-dark'
const maxBlocks = 500

const blockCount = ref(60)
const repeatCount = ref(6)
const batchRuns = ref(5)
const batchDelayMs = ref(200)
const tokenCache = ref(true)
const tokenCacheMaxEntries = ref(50)
const htmlCache = ref(true)
const htmlCacheMaxEntries = ref(30)
const ready = ref(false)
const running = ref(false)
const longTaskSupport = ref<'yes' | 'no'>('no')
const results = ref<null | {
  cpuMs: number
  paintMs: number
  longTasks: number
  blocks: number
  lines: number
  chars: number
}>(null)
const batchResults = ref<Array<{
  run: number
  cpuMs: number
  paintMs: number
  longTasks: number
}>>([])
const batchSummary = ref<null | {
  runs: number
  avgCpuMs: number
  avgPaintMs: number
  minCpuMs: number
  maxCpuMs: number
  minPaintMs: number
  maxPaintMs: number
}>(null)

const streamBlockCount = ref(12)
const streamRepeatCount = ref(6)
const streamChunkSize = ref(64)
const streamDelayMs = ref(0)
const streamCompareMode = ref<'signature' | 'innerHTML'>('signature')
const streamTokenCache = ref(true)
const streamResults = ref<null | {
  cpuMs: number
  paintMs: number
  longTasks: number
  blocks: number
  lines: number
  chars: number
  chunkSize: number
  updates: number
}>(null)

const wrapper = ref<HTMLDivElement | null>(null)
let blocks: HTMLDivElement[] = []
const streamWrapper = ref<HTMLDivElement | null>(null)
let streamBlocks: HTMLDivElement[] = []
let highlighter: any = null
let longObserver: PerformanceObserver | null = null
let longTaskCount = 0

function buildCode(repeatValue: number) {
  const base = typescriptContent.trimEnd()
  const repeat = Math.max(1, Math.floor(repeatValue || 1))
  const code = Array.from({ length: repeat }, () => base).join('\n')
  return code
}

function ensureWrapper() {
  if (!wrapper.value)
    return null
  return wrapper.value
}

function setupContainers() {
  const el = ensureWrapper()
  if (!el)
    return
  el.innerHTML = ''
  blocks = []
  const count = Math.max(1, Math.min(maxBlocks, Math.floor(blockCount.value || 1)))
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div')
    div.className = 'perf-block'
    el.appendChild(div)
    blocks.push(div)
  }
}

function clearContainers() {
  const el = ensureWrapper()
  if (!el)
    return
  el.innerHTML = ''
  blocks = []
  results.value = null
}

function ensureStreamWrapper() {
  if (!streamWrapper.value)
    return null
  return streamWrapper.value
}

function setupStreamContainers() {
  const el = ensureStreamWrapper()
  if (!el)
    return
  el.innerHTML = ''
  streamBlocks = []
  const count = Math.max(1, Math.min(maxBlocks, Math.floor(streamBlockCount.value || 1)))
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div')
    div.className = 'perf-block'
    el.appendChild(div)
    streamBlocks.push(div)
  }
}

function clearStreamContainers() {
  const el = ensureStreamWrapper()
  if (!el)
    return
  el.innerHTML = ''
  streamBlocks = []
  streamResults.value = null
}

async function ensureHighlighter() {
  if (highlighter)
    return highlighter
  highlighter = await registerHighlight({ langs: [lang], themes: [theme] })
  return highlighter
}

function startLongObserver() {
  longTaskCount = 0
  if (typeof PerformanceObserver === 'undefined') {
    longTaskSupport.value = 'no'
    return
  }
  const supported = (PerformanceObserver as any).supportedEntryTypes?.includes('longtask')
  if (!supported) {
    longTaskSupport.value = 'no'
    return
  }
  longTaskSupport.value = 'yes'
  longObserver = new PerformanceObserver((list) => {
    longTaskCount += list.getEntries().length
  })
  try {
    longObserver.observe({ type: 'longtask', buffered: false })
  }
  catch {
    longTaskSupport.value = 'no'
  }
}

function stopLongObserver() {
  if (longObserver) {
    longObserver.disconnect()
    longObserver = null
  }
}

function detectLongTaskSupport() {
  if (typeof PerformanceObserver === 'undefined') {
    longTaskSupport.value = 'no'
    return
  }
  const supported = (PerformanceObserver as any).supportedEntryTypes?.includes('longtask')
  longTaskSupport.value = supported ? 'yes' : 'no'
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatMs(ms: number) {
  return Math.round(ms * 100) / 100
}

function clearBatchResults() {
  batchResults.value = []
  batchSummary.value = null
}

async function runFullRenderOnce() {
  await ensureHighlighter()
  if (!blocks.length)
    setupContainers()
  const code = buildCode(repeatCount.value)
  const lineCount = code.split('\n').length
  const charCount = code.length

  startLongObserver()
  const t0 = performance.now()
  for (const el of blocks) {
    el.innerHTML = renderCodeWithTokens(highlighter, code, {
      lang,
      theme,
      tokenCache: tokenCache.value,
      tokenCacheMaxEntries: tokenCacheMaxEntries.value,
      htmlCache: htmlCache.value,
      htmlCacheMaxEntries: htmlCacheMaxEntries.value,
    })
  }
  const t1 = performance.now()
  await nextPaint()
  const t2 = performance.now()
  stopLongObserver()

  return {
    cpuMs: t1 - t0,
    paintMs: t2 - t0,
    longTasks: longTaskCount,
    blocks: blocks.length,
    lines: lineCount,
    chars: charCount,
  }
}

async function runFullRender() {
  if (running.value)
    return
  running.value = true
  results.value = null
  try {
    const res = await runFullRenderOnce()
    results.value = res
    return res
  }
  finally {
    running.value = false
  }
}

async function runBatchFullRender() {
  if (running.value)
    return
  running.value = true
  batchResults.value = []
  batchSummary.value = null
  try {
    const runs = Math.max(1, Math.floor(batchRuns.value || 1))
    const delay = Math.max(0, Math.floor(batchDelayMs.value || 0))
    for (let i = 0; i < runs; i++) {
      const res = await runFullRenderOnce()
      batchResults.value.push({
        run: i + 1,
        cpuMs: res.cpuMs,
        paintMs: res.paintMs,
        longTasks: res.longTasks,
      })
      results.value = res
      if (delay > 0 && i < runs - 1)
        await sleep(delay)
    }
    const cpuValues = batchResults.value.map(r => r.cpuMs)
    const paintValues = batchResults.value.map(r => r.paintMs)
    const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length
    const avgPaint = paintValues.reduce((a, b) => a + b, 0) / paintValues.length
    batchSummary.value = {
      runs: batchResults.value.length,
      avgCpuMs: avgCpu,
      avgPaintMs: avgPaint,
      minCpuMs: Math.min(...cpuValues),
      maxCpuMs: Math.max(...cpuValues),
      minPaintMs: Math.min(...paintValues),
      maxPaintMs: Math.max(...paintValues),
    }
    return batchSummary.value
  }
  finally {
    running.value = false
  }
}

async function runStreamRender() {
  if (running.value)
    return
  running.value = true
  streamResults.value = null
  try {
    await ensureHighlighter()
    if (!streamBlocks.length)
      setupStreamContainers()

    const code = buildCode(streamRepeatCount.value)
    const lineCount = code.split('\n').length
    const charCount = code.length
    const chunk = Math.max(1, Math.floor(streamChunkSize.value || 1))
    const delay = Math.max(0, Math.floor(streamDelayMs.value || 0))
    for (const el of streamBlocks)
      el.innerHTML = ''
    const opts = {
      lang,
      theme,
      compareMode: streamCompareMode.value,
      tokenCache: streamTokenCache.value,
      tokenCacheMaxEntries: tokenCacheMaxEntries.value,
    }

    let current = ''
    let updates = 0
    startLongObserver()
    const t0 = performance.now()
    for (let i = 0; i < code.length; i += chunk) {
      current += code.slice(i, i + chunk)
      for (const el of streamBlocks) {
        updateCodeTokensIncremental(el, highlighter, current, opts)
      }
      updates++
      if (delay > 0)
        await sleep(delay)
    }
    const t1 = performance.now()
    await nextPaint()
    const t2 = performance.now()
    stopLongObserver()

    streamResults.value = {
      cpuMs: t1 - t0,
      paintMs: t2 - t0,
      longTasks: longTaskCount,
      blocks: streamBlocks.length,
      lines: lineCount,
      chars: charCount,
      chunkSize: chunk,
      updates,
    }
    return streamResults.value
  }
  finally {
    running.value = false
  }
}

onMounted(async () => {
  await ensureHighlighter()
  ready.value = true
  detectLongTaskSupport()
  setupContainers()
  setupStreamContainers()
  exposeApi()
})

onUnmounted(() => {
  stopLongObserver()
})

function setConfig(config: Partial<{
  blockCount: number
  repeatCount: number
  batchRuns: number
  batchDelayMs: number
  tokenCache: boolean
  tokenCacheMaxEntries: number
  htmlCache: boolean
  htmlCacheMaxEntries: number
  streamBlockCount: number
  streamRepeatCount: number
  streamChunkSize: number
  streamDelayMs: number
  streamCompareMode: 'signature' | 'innerHTML'
  streamTokenCache: boolean
}>) {
  if (typeof config.blockCount === 'number')
    blockCount.value = config.blockCount
  if (typeof config.repeatCount === 'number')
    repeatCount.value = config.repeatCount
  if (typeof config.batchRuns === 'number')
    batchRuns.value = config.batchRuns
  if (typeof config.batchDelayMs === 'number')
    batchDelayMs.value = config.batchDelayMs
  if (typeof config.tokenCache === 'boolean')
    tokenCache.value = config.tokenCache
  if (typeof config.tokenCacheMaxEntries === 'number')
    tokenCacheMaxEntries.value = config.tokenCacheMaxEntries
  if (typeof config.htmlCache === 'boolean')
    htmlCache.value = config.htmlCache
  if (typeof config.htmlCacheMaxEntries === 'number')
    htmlCacheMaxEntries.value = config.htmlCacheMaxEntries
  if (typeof config.streamBlockCount === 'number')
    streamBlockCount.value = config.streamBlockCount
  if (typeof config.streamRepeatCount === 'number')
    streamRepeatCount.value = config.streamRepeatCount
  if (typeof config.streamChunkSize === 'number')
    streamChunkSize.value = config.streamChunkSize
  if (typeof config.streamDelayMs === 'number')
    streamDelayMs.value = config.streamDelayMs
  if (config.streamCompareMode)
    streamCompareMode.value = config.streamCompareMode
  if (typeof config.streamTokenCache === 'boolean')
    streamTokenCache.value = config.streamTokenCache
  setupContainers()
  setupStreamContainers()
}

function exposeApi() {
  if (typeof window === 'undefined')
    return
  const api = {
    isReady: () => ready.value,
    setConfig,
    runFullRender,
    runBatchFullRender,
    runStreamRender,
    getResults: () => ({
      results: results.value,
      batchResults: batchResults.value,
      batchSummary: batchSummary.value,
      streamResults: streamResults.value,
    }),
  }
  ;(window as any).__streamMarkdownPerf = api
}
</script>

<template>
  <div class="space-y-4">
    <section class="flex flex-wrap items-end gap-3">
      <div>
        <label class="text-sm opacity-70">Blocks</label>
        <input v-model.number="blockCount" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">Repeat</label>
        <input v-model.number="repeatCount" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">Token cache</label>
        <select v-model="tokenCache" class="border rounded px-2 py-1 w-28 bg-transparent">
          <option :value="true">
            on
          </option>
          <option :value="false">
            off
          </option>
        </select>
      </div>
      <div>
        <label class="text-sm opacity-70">Token cache max</label>
        <input v-model.number="tokenCacheMaxEntries" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">HTML cache</label>
        <select v-model="htmlCache" class="border rounded px-2 py-1 w-28 bg-transparent">
          <option :value="true">
            on
          </option>
          <option :value="false">
            off
          </option>
        </select>
      </div>
      <div>
        <label class="text-sm opacity-70">HTML cache max</label>
        <input v-model.number="htmlCacheMaxEntries" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">Token cache</label>
        <select v-model="tokenCache" class="border rounded px-2 py-1 w-28 bg-transparent">
          <option :value="true">
            on
          </option>
          <option :value="false">
            off
          </option>
        </select>
      </div>
      <div>
        <label class="text-sm opacity-70">Cache size</label>
        <input v-model.number="tokenCacheMaxEntries" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <button class="px-3 py-1 border rounded" :disabled="running" @click="setupContainers">
        Create containers
      </button>
      <button class="px-3 py-1 border rounded" :disabled="running || !ready" @click="runFullRender">
        Run full render
      </button>
      <button class="px-3 py-1 border rounded" :disabled="running" @click="clearContainers">
        Clear
      </button>
    </section>

    <section class="flex flex-wrap items-end gap-3">
      <div>
        <label class="text-sm opacity-70">Runs</label>
        <input v-model.number="batchRuns" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">Delay (ms)</label>
        <input v-model.number="batchDelayMs" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <button class="px-3 py-1 border rounded" :disabled="running || !ready" @click="runBatchFullRender">
        Run batch
      </button>
      <button class="px-3 py-1 border rounded" :disabled="running" @click="clearBatchResults">
        Clear batch
      </button>
    </section>

    <section class="text-sm">
      <div>Highlighter: {{ ready ? 'ready' : 'loading' }}</div>
      <div>Longtask observer: {{ longTaskSupport === 'yes' ? 'supported' : 'not supported' }}</div>
      <div class="opacity-70">
        Max blocks: {{ maxBlocks }}
      </div>
    </section>

    <section v-if="results" class="text-sm">
      <div>CPU render: {{ formatMs(results.cpuMs) }} ms</div>
      <div>To paint (double rAF): {{ formatMs(results.paintMs) }} ms</div>
      <div>Blocks: {{ results.blocks }} | Lines/block: {{ results.lines }} | Chars/block: {{ results.chars }}</div>
      <div>Long tasks: {{ results.longTasks }}</div>
    </section>

    <section v-if="batchSummary" class="text-sm">
      <div>Batch runs: {{ batchSummary.runs }}</div>
      <div>Avg CPU: {{ formatMs(batchSummary.avgCpuMs) }} ms | Avg paint: {{ formatMs(batchSummary.avgPaintMs) }} ms</div>
      <div>CPU min/max: {{ formatMs(batchSummary.minCpuMs) }} / {{ formatMs(batchSummary.maxCpuMs) }} ms</div>
      <div>Paint min/max: {{ formatMs(batchSummary.minPaintMs) }} / {{ formatMs(batchSummary.maxPaintMs) }} ms</div>
    </section>

    <section v-if="batchResults.length" class="text-xs perf-list">
      <div v-for="r in batchResults" :key="r.run">
        #{{ r.run }} — CPU: {{ formatMs(r.cpuMs) }} ms | Paint: {{ formatMs(r.paintMs) }} ms | Long: {{ r.longTasks }}
      </div>
    </section>

    <div ref="wrapper" class="perf-wrapper" />

    <hr class="opacity-20">

    <section class="flex flex-wrap items-end gap-3">
      <div>
        <label class="text-sm opacity-70">Stream blocks</label>
        <input v-model.number="streamBlockCount" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">Repeat</label>
        <input v-model.number="streamRepeatCount" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">Chunk size</label>
        <input v-model.number="streamChunkSize" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">Delay (ms)</label>
        <input v-model.number="streamDelayMs" type="number" class="border rounded px-2 py-1 w-24">
      </div>
      <div>
        <label class="text-sm opacity-70">Compare</label>
        <select v-model="streamCompareMode" class="border rounded px-2 py-1 w-28 bg-transparent">
          <option value="signature">
            signature
          </option>
          <option value="innerHTML">
            innerHTML
          </option>
        </select>
      </div>
      <div>
        <label class="text-sm opacity-70">Token cache</label>
        <select v-model="streamTokenCache" class="border rounded px-2 py-1 w-28 bg-transparent">
          <option :value="true">
            on
          </option>
          <option :value="false">
            off
          </option>
        </select>
      </div>
      <button class="px-3 py-1 border rounded" :disabled="running" @click="setupStreamContainers">
        Create stream containers
      </button>
      <button class="px-3 py-1 border rounded" :disabled="running || !ready" @click="runStreamRender">
        Run stream
      </button>
      <button class="px-3 py-1 border rounded" :disabled="running" @click="clearStreamContainers">
        Clear stream
      </button>
    </section>

    <section class="text-xs opacity-70">
      Stream test uses immediate incremental updates (no idle/rAF scheduler) to stress token diff.
    </section>

    <section v-if="streamResults" class="text-sm">
      <div>CPU stream: {{ formatMs(streamResults.cpuMs) }} ms</div>
      <div>To paint (double rAF): {{ formatMs(streamResults.paintMs) }} ms</div>
      <div>Blocks: {{ streamResults.blocks }} | Lines/block: {{ streamResults.lines }} | Chars/block: {{ streamResults.chars }}</div>
      <div>Chunk: {{ streamResults.chunkSize }} chars | Updates: {{ streamResults.updates }}</div>
      <div>Long tasks: {{ streamResults.longTasks }}</div>
    </section>

    <div ref="streamWrapper" class="perf-wrapper" />
  </div>
</template>

<style scoped>
.perf-wrapper {
  max-height: 60vh;
  overflow: auto;
  border: 1px solid var(--border);
  padding: 8px;
}

.perf-block {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  padding: 6px;
  min-height: 24px;
}

.perf-list {
  max-height: 180px;
  overflow: auto;
  border: 1px dashed var(--border);
  padding: 6px;
}
</style>
