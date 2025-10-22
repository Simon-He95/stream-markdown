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
let i = 0
const content = ref('')

onMounted(async () => {
  // Init renderer with current lang/theme
  renderer = createShikiStreamRenderer(container.value!, {
    lang: props.lang,
    theme: props.theme ?? 'vitesse-dark',
    themes: props.themes,
  })

  const stopTimer = () => {
    if (timer)
      window.clearInterval(timer)
    timer = undefined
  }

  const startTimer = () => {
    stopTimer()
    const interval = props.intervalMs ?? 25
    timer = window.setInterval(async () => {
      if (i >= props.source.length) {
        stopTimer()
        return
      }
      content.value += props.source[i]
      await renderer!.updateCode(content.value)
      i++
    }, interval)
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
