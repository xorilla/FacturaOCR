<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    compact?: boolean
    disabled?: boolean
    maxPages?: number
  }>(),
  { compact: false, disabled: false, maxPages: 10 },
)

const emit = defineEmits<{
  files: [File[]]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
const dragActive = ref(false)

function emitFiles(list: FileList | null): void {
  if (!list?.length) return
  emit('files', [...list])
}

function onChange(event: Event): void {
  const input = event.target as HTMLInputElement
  emitFiles(input.files)
  input.value = ''
}

function onDrop(event: DragEvent): void {
  dragActive.value = false
  emitFiles(event.dataTransfer?.files ?? null)
}
</script>

<template>
  <section
    class="dropzone"
    :class="{
      'dropzone--compact': compact,
      'dropzone--active': dragActive,
      'dropzone--disabled': disabled,
    }"
    @dragover.prevent="!disabled && (dragActive = true)"
    @dragleave.prevent="dragActive = false"
    @drop.prevent="!disabled && onDrop($event)"
  >
    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      accept="image/*,application/pdf,.pdf"
      multiple
      :disabled="disabled"
      @change="onChange"
    />
    <input
      ref="cameraInput"
      class="sr-only"
      type="file"
      accept="image/*"
      capture="environment"
      :disabled="disabled"
      @change="onChange"
    />

    <div v-if="!compact" class="dropzone__art" aria-hidden="true">
      <div class="dropzone__sheet dropzone__sheet--back" />
      <div class="dropzone__sheet dropzone__sheet--front">
        <span class="dropzone__line dropzone__line--short" />
        <span class="dropzone__line" />
        <span class="dropzone__line dropzone__line--medium" />
      </div>
      <span class="dropzone__badge"><AppIcon name="zap" :size="14" /></span>
    </div>

    <div class="dropzone__copy">
      <p class="eyebrow">{{ compact ? 'Nou document' : 'Comença aquí' }}</p>
      <h2>{{ compact ? 'Afegeix un fitxer' : 'Factures i tiquets, en dades' }}</h2>
      <p class="muted">
        {{ compact
          ? 'Foto, imatge o PDF. Tot es processa al navegador.'
          : 'Arrossega una foto o un PDF. L’OCR corre al teu dispositiu: cap fitxer surt del navegador.'
        }}
      </p>
    </div>

    <div class="dropzone__actions">
      <button
        class="btn btn--primary"
        type="button"
        :disabled="disabled"
        @click="fileInput?.click()"
      >
        <AppIcon name="upload" :size="16" />
        Triar fitxers
      </button>
      <button
        class="btn btn--ghost"
        type="button"
        :disabled="disabled"
        @click="cameraInput?.click()"
      >
        <AppIcon name="camera" :size="16" />
        Fer foto
      </button>
    </div>

    <p v-if="!compact" class="dropzone__hint">
      JPG, PNG, WebP, HEIC o PDF · fins a 30 MB · PDF de fins a
      {{ maxPages }} pàgines
    </p>
    <p v-else class="dropzone__hint dropzone__hint--compact">
      <AppIcon name="lock" :size="12" />
      Sense pujades
    </p>
  </section>
</template>
