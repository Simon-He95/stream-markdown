<script setup lang="ts">
import { bundledThemesInfo } from 'shiki/themes'
import { createShikiStreamRenderer, getQueueLength, getTimeBudget, registerHighlight, restoreWithVisibilityPriority, setTimeBudget } from 'stream-markdown'
import { onMounted, onUnmounted, ref } from 'vue'
import { isDark } from '~/composables/dark'
import CodeStream from '../components/CodeStream.vue'
import { markdownContent, phpContent, vueContent } from './markdown'

// Build theme options from Shiki's bundled theme list
const themes = bundledThemesInfo.map(t => ({ id: t.id, label: t.displayName ?? t.id }))
const allThemeIds = themes.map(t => t.id)

// Default to vitesse based on current dark mode; user can override via dropdown
const selectedTheme = ref(isDark.value ? 'vitesse-dark' : 'vitesse-light')
const restoreCount = ref(60)
const restoreRunning = ref(false)
const restoreWrapper = ref<HTMLElement | null>(null)
let activeRenderers: Array<ReturnType<typeof createShikiStreamRenderer>> = []
let cancelRestore: (() => void) | null = null
const schedulerQueueLen = ref(0)
const schedulerTimeBudget = ref(getTimeBudget())
let metricsInterval: number | undefined
registerHighlight()

onUnmounted(() => {
  if (cancelRestore)
    cancelRestore()
  for (const r of activeRenderers) r.dispose()
  activeRenderers = []
  if (metricsInterval != null)
    clearInterval(metricsInterval)
})

onMounted(() => {
  // Update metrics every 250ms
  metricsInterval = window.setInterval(() => {
    schedulerQueueLen.value = getQueueLength()
    schedulerTimeBudget.value = getTimeBudget()
  }, 250)
})

async function startRestoreDemo() {
  if (!restoreWrapper.value)
    return
  // cleanup previous
  if (cancelRestore)
    cancelRestore()
  for (const r of activeRenderers) r.dispose()
  activeRenderers = []
  restoreWrapper.value.innerHTML = ''

  const items: any[] = []
  const N = Math.max(1, Math.min(300, restoreCount.value || 60))
  for (let i = 0; i < N; i++) {
    const el = document.createElement('div')
    el.style.marginBottom = '6px'
    el.style.minHeight = '36px'
    el.style.border = '1px solid var(--border)'
    el.style.padding = '6px'
    restoreWrapper.value.appendChild(el)

    const renderer = createShikiStreamRenderer(el, { lang: 'typescript', theme: selectedTheme.value })
    activeRenderers.push(renderer)

    // create render function that sets code (simulate restored snapshot)
    const code = vueContent
    items.push({ el, render: () => {
      renderer.updateCode(code)
    } })
  }

  restoreRunning.value = true
  // Use visibility-prioritized restore with small batches
  cancelRestore = restoreWithVisibilityPriority(items, { batchSize: 8, staggerMs: 30, drainVisible: false })
}

function stopRestoreDemo() {
  if (cancelRestore)
    cancelRestore()
  cancelRestore = null
  for (const r of activeRenderers) r.dispose()
  activeRenderers = []
  if (restoreWrapper.value)
    restoreWrapper.value.innerHTML = ''
  restoreRunning.value = false
}
</script>

<template>
  <header class="mb-6">
    <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">
      Stream Markdown
    </h1>
    <p class="mt-2 max-w-2xl text-sm sm:text-base opacity-80">
      Shiki-based incremental renderer for streaming code and Markdown. Updates only changed lines for fast live syntax highlighting.
    </p>
  </header>
  <div class="mb-4 flex items-center gap-2">
    <label for="theme-select" class="text-sm opacity-70">Theme:</label>
    <select id="theme-select" v-model="selectedTheme" class="border rounded px-2 py-1 bg-transparent">
      <option v-for="t in themes" :key="t.id" :value="t.id">
        {{ t.label }}
      </option>
    </select>
  </div>

  <CodeStream label="Vue" lang="vue" :source="vueContent" :interval-ms="20" :theme="selectedTheme" :themes="allThemeIds" />
  <section class="mt-6">
    <CodeStream label="Markdown" lang="markdown" :source="markdownContent" :interval-ms="25" :theme="selectedTheme" :themes="allThemeIds" />
  </section>
  <section class="mt-6">
    <CodeStream label="PHP" lang="php" :source="phpContent" :interval-ms="30" :theme="selectedTheme" :themes="allThemeIds" />
  </section>

  <section class="mt-8">
    <h3 class="mb-2 font-semibold">
      Restore demo
    </h3>
    <div class="mb-2 flex items-center gap-2">
      <label class="text-sm opacity-70">Count:</label>
      <input v-model="restoreCount" type="number" class="border rounded px-2 py-1 w-24">
      <button class="px-3 py-1 border rounded" :disabled="restoreRunning" @click="startRestoreDemo">
        Start restore
      </button>
      <button class="px-3 py-1 border rounded" :disabled="!restoreRunning" @click="stopRestoreDemo">
        Stop
      </button>
      <div class="ml-4 text-sm">
        <div>Queue: {{ schedulerQueueLen }}</div>
        <div class="mt-1">
          Time budget: <input v-model.number="schedulerTimeBudget" type="number" class="w-20 border rounded px-1" @change="setTimeBudget(Number(schedulerTimeBudget))"> ms
        </div>
      </div>
    </div>
    <div ref="restoreWrapper" />
  </section>
</template>

<style scoped>
/* stream demo */
</style>
