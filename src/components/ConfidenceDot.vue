<script setup lang="ts">
import { computed } from 'vue'
import type { Confidence } from '../lib/extract'

const props = defineProps<{
  confidence: Confidence
  showLabel?: boolean
}>()

const label = computed(() => {
  if (props.confidence === 'high') return 'Confiança alta'
  if (props.confidence === 'medium') return 'Confiança mitjana'
  return 'Confiança baixa'
})
</script>

<template>
  <span class="confidence" :class="`confidence--${confidence}`" :title="label">
    <span class="confidence__dot" aria-hidden="true" />
    <span v-if="showLabel" class="confidence__label">{{ label }}</span>
  </span>
</template>
