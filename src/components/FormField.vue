<script setup lang="ts">
import type { Confidence } from '../lib/extract'
import ConfidenceDot from './ConfidenceDot.vue'

withDefaults(
  defineProps<{
    label: string
    confidence?: Confidence
    hint?: string | null
    wide?: boolean
  }>(),
  { confidence: undefined, hint: null, wide: false },
)
</script>

<template>
  <label class="field" :class="{ 'field--wide': wide }">
    <span class="field__head">
      <span class="field__label">{{ label }}</span>
      <ConfidenceDot v-if="confidence" :confidence="confidence" />
    </span>
    <slot />
    <span v-if="hint" class="field__hint">{{ hint }}</span>
  </label>
</template>
