<script setup lang="ts">
import { computed } from 'vue'
import type { PageView } from '../composables/useDocuments'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    page: PageView | null
    thumbnail?: string
    highlighted?: number[]
    lineOffset?: number
    showBoxes?: boolean
  }>(),
  { highlighted: () => [], lineOffset: 0, showBoxes: true },
)

const boxes = computed(() => {
  if (!props.page) return []
  return props.page.lines.map((line, index) => ({
    line,
    index: index + props.lineOffset,
    key: `${index}-${line.box.xmin}-${line.box.ymin}`,
  }))
})

function isHighlighted(index: number): boolean {
  return props.highlighted.includes(index)
}
</script>

<template>
  <div class="preview">
    <div v-if="page" class="preview__frame">
      <img
        class="preview__image"
        :src="page.imageUrl"
        :alt="`Pàgina ${page.page + 1}`"
        draggable="false"
      />
      <svg
        v-if="showBoxes && page.lines.length"
        class="preview__overlay"
        :viewBox="`0 0 ${page.width} ${page.height}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          v-for="box in boxes"
          :key="box.key"
          :x="box.line.box.xmin"
          :y="box.line.box.ymin"
          :width="Math.max(1, box.line.box.xmax - box.line.box.xmin)"
          :height="Math.max(1, box.line.box.ymax - box.line.box.ymin)"
          :class="['ocr-box', { 'ocr-box--active': isHighlighted(box.index) }]"
        >
          <title>{{ box.line.text }} · {{ Math.round(box.line.score * 100) }}%</title>
        </rect>
      </svg>
      <span class="preview__meta">
        <AppIcon name="eye" :size="13" />
        {{ page.lines.length }} línies
        <span v-if="page.confidence">· {{ Math.round(page.confidence * 100) }}%</span>
      </span>
    </div>

    <div v-else-if="thumbnail" class="preview__frame">
      <img class="preview__image" :src="thumbnail" alt="Document desat" draggable="false" />
      <span class="preview__meta">Vista desada</span>
    </div>

    <div v-else class="preview__empty">
      <AppIcon name="file-text" :size="34" />
      <p>Encara no hi ha cap pàgina per mostrar.</p>
    </div>
  </div>
</template>
