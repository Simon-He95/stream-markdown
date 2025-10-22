<script setup lang="ts">
import { isDark, toggleDark } from '~/composables'
</script>

<template>
  <nav class="text-xl mt-6 inline-flex gap-2">
    <button class="icon-btn !outline-none" @click="toggleDark()">
      <div v-if="isDark" class="i-carbon-moon" />
      <div v-else class="i-carbon-sun" />
    </button>
    <a
      class="i-carbon-logo-github"
      rel="noreferrer"
      href="https://github.com/Simon-He95/my-vitesse-app"
      target="_blank"
      title="GitHub"
    />
  </nav>
</template>
