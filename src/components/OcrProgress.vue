<script setup lang="ts">
import { computed } from 'vue'
import type { OcrStatus } from '../composables/useOcr'

const props = defineProps<{
  status: OcrStatus
  progress: number | null
  message: string
  device?: 'webgpu' | 'wasm' | null
  compact?: boolean
}>()

const busy = computed(() => props.status === 'loading' || props.status === 'reading')
const percent = computed(() =>
  typeof props.progress === 'number' ? Math.round(props.progress) : null,
)
const indeterminate = computed(() => busy.value && percent.value === null)
</script>

<template>
  <div class="ocr-progress" :class="{ 'ocr-progress--compact': compact }">
    <div class="ocr-progress__head">
      <span class="ocr-progress__label">
        <span v-if="busy" class="spinner" aria-hidden="true" />
        {{ message }}
      </span>
      <span v-if="device" class="pill pill--tiny">{{ device === 'webgpu' ? 'WebGPU' : 'WASM' }}</span>
    </div>
    <div
      v-if="busy || (percent !== null && percent < 100)"
      class="progress"
      :class="{ 'progress--indeterminate': indeterminate }"
      role="progressbar"
      :aria-valuenow="percent ?? undefined"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="progress__bar" :style="percent !== null ? { width: `${percent}%` } : undefined" />
    </div>
  </div>
</template>
