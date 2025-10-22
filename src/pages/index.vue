<script setup lang="ts">
import { bundledThemesInfo } from 'shiki/themes'
import { ref } from 'vue'
import { isDark } from '~/composables/dark'
import CodeStream from '../components/CodeStream.vue'
import { markdownContent, phpContent, typescriptContent } from './markdown'

// Build theme options from Shiki's bundled theme list
const themes = bundledThemesInfo.map(t => ({ id: t.id, label: t.displayName ?? t.id }))
const allThemeIds = themes.map(t => t.id)

// Default to vitesse based on current dark mode; user can override via dropdown
const selectedTheme = ref(isDark.value ? 'vitesse-dark' : 'vitesse-light')
</script>

<template>
  <div class="mb-4 flex items-center gap-2">
    <label for="theme-select" class="text-sm opacity-70">Theme:</label>
    <select id="theme-select" v-model="selectedTheme" class="border rounded px-2 py-1 bg-transparent">
      <option v-for="t in themes" :key="t.id" :value="t.id">
        {{ t.label }}
      </option>
    </select>
  </div>

  <CodeStream label="TypeScript" lang="typescript" :source="typescriptContent" :interval-ms="20" :theme="selectedTheme" :themes="allThemeIds" />
  <section class="mt-6">
    <CodeStream label="Markdown" lang="markdown" :source="markdownContent" :interval-ms="25" :theme="selectedTheme" :themes="allThemeIds" />
  </section>
  <section class="mt-6">
    <CodeStream label="PHP" lang="php" :source="phpContent" :interval-ms="30" :theme="selectedTheme" :themes="allThemeIds" />
  </section>
</template>

<style scoped>
/* stream demo */
</style>
