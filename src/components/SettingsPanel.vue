<script setup lang="ts">
import type { AppSettings } from '../composables/useDocuments'
import type { OcrStatus } from '../composables/useOcr'
import { MAX_PAGES_OPTIONS, MAX_SIDE_OPTIONS, MODEL_SIZES } from '../lib/models'
import AppIcon from './AppIcon.vue'

defineProps<{
  settings: AppSettings
  ocrStatus: OcrStatus
  device?: 'webgpu' | 'wasm' | null
}>()

const emit = defineEmits<{
  close: []
  reset: []
}>()
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="modal__head">
        <div>
          <p class="eyebrow">Configuració</p>
          <h2 id="settings-title">Qualitat i rendiment</h2>
        </div>
        <button class="icon-btn" type="button" aria-label="Tancar" @click="emit('close')">
          <AppIcon name="close" :size="18" />
        </button>
      </header>

      <div class="modal__body">
        <fieldset class="settings-group">
          <legend>Model OCR</legend>
          <p class="muted">
            El model es descarrega una vegada i queda a la memòria cau del navegador.
          </p>
          <div class="model-options">
            <label
              v-for="model in MODEL_SIZES"
              :key="model.value"
              class="model-option"
              :class="{ 'model-option--active': settings.size === model.value }"
            >
              <input v-model="settings.size" type="radio" :value="model.value" name="model-size" />
              <span class="model-option__top">
                <span class="model-option__name">{{ model.label }}</span>
                <span class="pill pill--tiny">{{ model.download }}</span>
              </span>
              <span class="model-option__hint">{{ model.hint }}</span>
            </label>
          </div>
        </fieldset>

        <div class="settings-grid">
          <label class="field">
            <span class="field__head"><span class="field__label">Resolució màxima</span></span>
            <select v-model.number="settings.maxSide">
              <option v-for="side in MAX_SIDE_OPTIONS" :key="side" :value="side">
                {{ side }} px
              </option>
            </select>
            <span class="field__hint">Més resolució ajuda en tiquets petits, però triga més.</span>
          </label>

          <label class="field">
            <span class="field__head"><span class="field__label">Pàgines màximes del PDF</span></span>
            <select v-model.number="settings.maxPages">
              <option v-for="pages in MAX_PAGES_OPTIONS" :key="pages" :value="pages">
                {{ pages }} pàgines
              </option>
            </select>
            <span class="field__hint">La resta de pàgines s’ignoren per no bloquejar el navegador.</span>
          </label>
        </div>

        <label class="toggle">
          <input v-model="settings.enhance" type="checkbox" />
          <span>
            <span class="toggle__title">Millorar el contrast</span>
            <span class="toggle__hint">
              Converteix a escala de grisos i augmenta el contrast. Útil per a fotos fosques.
            </span>
          </span>
        </label>

        <div class="settings-status">
          <span class="pill pill--soft">
            <AppIcon name="cpu" :size="13" />
            {{ device ? (device === 'webgpu' ? 'WebGPU' : 'WASM') : 'Encara no carregat' }}
          </span>
          <span class="muted">{{ ocrStatus === 'ready' ? 'Model a punt' : 'El model es carregarà al primer document' }}</span>
        </div>

        <p class="settings-note">
          Els canvis s’apliquen al següent document o quan premi «Re-processar» al document obert.
        </p>
      </div>

      <footer class="modal__foot">
        <button class="btn btn--ghost" type="button" @click="emit('reset')">
          Restaurar valors
        </button>
        <button class="btn btn--primary" type="button" @click="emit('close')">
          Fet
        </button>
      </footer>
    </section>
  </div>
</template>
