<script setup lang="ts">
import { createShikiStreamRenderer } from 'stream-markdown'
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  label: string
  lang: string
  source: string
  theme?: string
  themes?: any[]
  intervalMs?: number
}>()

const container = ref<HTMLDivElement | null>(null)
let renderer: ReturnType<typeof createShikiStreamRenderer> | null = null
let timer: number | undefined
let rafId: number | undefined
let i = 0
const content = ref('')

onMounted(async () => {
  // Init renderer with current lang/theme
  renderer = createShikiStreamRenderer(container.value!, {
    lang: props.lang,
    theme: props.theme ?? 'vitesse-dark',
    themes: props.themes,
    // Component侧已用rAF批处理，这里禁用renderer层的rAF以避免双重调度
    scheduleInRaf: false,
  })

  const stopTimer = () => {
    if (timer)
      window.clearInterval(timer)
    if (rafId != null)
      cancelAnimationFrame(rafId)
    timer = undefined
    rafId = undefined
  }

  const startTimer = () => {
    stopTimer()
    // Convert intervalMs (~per-char delay) into chars per frame when using rAF.
    const interval = props.intervalMs ?? 25
    const charsPerSecond = 1000 / Math.max(1, interval)
    const charsPerFrame = Math.max(1, Math.round(charsPerSecond / 60))

    const tick = async () => {
      if (!renderer) return
      if (i >= props.source.length) {
        stopTimer()
        return
      }
      // Batch multiple characters per frame to reduce tokenization frequency
      let added = 0
      const start = performance.now()
      while (i < props.source.length && added < charsPerFrame) {
        content.value += props.source[i]
        i++
        added++
      }
      await renderer.updateCode(content.value)

      // If tab is hidden, slow down updates to save CPU
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(() => {
          rafId = requestAnimationFrame(tick)
        }, 200)
        return
      }

      // Try to keep budget per frame small; if heavy, naturally next rAF will schedule later
      const elapsed = performance.now() - start
      if (elapsed > 12 && (i + 1) < props.source.length) {
        // If we exceeded budget, next frame will handle remaining work
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
  }

  // Kick off streaming
  await renderer.updateCode(content.value, props.lang)
  startTimer()

  // Lang changes: let renderer decide to re-init if needed
  watch(() => props.lang, async (lang) => {
    if (!renderer)
      return
    await renderer.updateCode(content.value, lang)
  })

  // Theme changes: ask renderer to re-init if changed
  watch(() => props.theme, async (theme) => {
    if (!renderer)
      return
    await renderer.setTheme(theme ?? 'vitesse-dark')
  })

  // Interval changes: restart timer, keep progress
  watch(() => props.intervalMs, () => {
    startTimer()
  })

  // Source changes: restart streaming from scratch
  watch(() => props.source, async () => {
    stopTimer()
    i = 0
    content.value = ''
    await renderer!.updateCode('')
    startTimer()
  })
})

onUnmounted(() => {
  if (timer)
    window.clearInterval(timer)
  if (rafId != null)
    cancelAnimationFrame(rafId)
  renderer?.dispose()
})
</script>

<template>
  <section>
    <h3 class="mb-2 font-semibold">
      {{ props.label }}
    </h3>
    <div ref="container" />
  </section>
</template>
