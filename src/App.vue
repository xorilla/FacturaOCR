<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './components/AppIcon.vue'
import DocumentDropzone from './components/DocumentDropzone.vue'
import DocumentPreview from './components/DocumentPreview.vue'
import HistoryList from './components/HistoryList.vue'
import InvoiceForm from './components/InvoiceForm.vue'
import OcrProgress from './components/OcrProgress.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { useDocuments } from './composables/useDocuments'
import { useOcr } from './composables/useOcr'
import type { DocumentKind, SourceRef } from './lib/extract'
import { formatAmount } from './lib/extract'
import {
  copyText,
  downloadInvoiceJson,
  downloadInvoicesCsv,
  invoiceToJson,
} from './lib/export'
import { MODEL_SIZES } from './lib/models'
import type { HistoryEntry } from './lib/storage'

const {
  documents,
  selected,
  selectedId,
  history,
  notice,
  settings,
  exportable,
  isBusy,
  addFiles,
  selectDoc,
  selectPage,
  removeDoc,
  reprocessDoc,
  rotatePage,
  openHistory,
  removeHistoryEntry,
  refreshHistory,
  saveCurrent,
  setActivePageForSources,
  resetSettings,
  notify,
} = useDocuments()

const { status, progress, message, device, loadedSize } = useOcr()

const showSettings = ref(false)
const showBoxes = ref(true)
const highlighted = ref<SourceRef[]>([])

const activePage = computed(() => {
  const doc = selected.value
  if (!doc) return null
  return doc.pages[doc.activePage] ?? null
})

const lineOffset = computed(() => {
  const doc = selected.value
  if (!doc) return 0
  return doc.pages
    .slice(0, doc.activePage)
    .reduce((total, page) => total + page.lines.length, 0)
})

const highlightedLines = computed(() => highlighted.value.map((source) => source.line))

const modelLabel = computed(() => {
  const model = MODEL_SIZES.find((candidate) => candidate.value === settings.size)
  return model ? `${model.label} · ${model.download}` : 'Model'
})

const modelStateLabel = computed(() => {
  if (status.value === 'loading') return 'Carregant…'
  if (status.value === 'reading') return 'Reconeixent…'
  if (status.value === 'ready') {
    if (loadedSize.value && loadedSize.value !== settings.size) return 'Pendent'
    return device.value === 'webgpu' ? 'WebGPU' : 'WASM'
  }
  if (status.value === 'error') return 'Error'
  return 'Inactiu'
})

function onFiles(files: File[]): void {
  addFiles(files)
}

function onPaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  if (files.length) {
    event.preventDefault()
    addFiles(files)
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') showSettings.value = false
}

function onFocusField(sources: SourceRef[]): void {
  highlighted.value = sources
  setActivePageForSources(sources)
}

function onBlurField(): void {
  highlighted.value = []
}

function onFormChange(): void {
  if (selected.value) selected.value.saved = false
}

function rotate(delta: number): void {
  if (selected.value) void rotatePage(selected.value, delta)
}

function reprocess(): void {
  if (selected.value) void reprocessDoc(selected.value)
}

function save(): void {
  if (selected.value) void saveCurrent(selected.value)
}

function deleteDoc(): void {
  const doc = selected.value
  if (!doc) return
  if (!window.confirm('Vols tancar aquest document de la vista? L’historial es conserva.')) return
  void removeDoc(doc.id)
}

function deleteHistoryItem(id: string): void {
  if (!window.confirm('Vols esborrar aquest document de l’historial?')) return
  void removeHistoryEntry(id)
}

function openHistoryEntry(entry: HistoryEntry): void {
  openHistory(entry)
  highlighted.value = []
}

function fileStem(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function exportJson(): void {
  const doc = selected.value
  if (!doc?.invoice) return
  downloadInvoiceJson(doc.invoice, fileStem(doc.name))
}

function exportCsv(): void {
  const doc = selected.value
  if (!doc?.invoice) return
  downloadInvoicesCsv([{ invoice: doc.invoice, name: doc.name }], fileStem(doc.name))
}

function exportAllCsv(): void {
  if (!exportable.value.length) {
    notify('Encara no hi ha cap document processat per exportar.', 'info')
    return
  }
  downloadInvoicesCsv(exportable.value, 'factures')
}

async function copyJson(): Promise<void> {
  const doc = selected.value
  if (!doc?.invoice) return
  try {
    await copyText(invoiceToJson(doc.invoice))
    notify('JSON copiat al porta-retalls.', 'success')
  } catch {
    notify('No s’ha pogut copiar el JSON.', 'error')
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return 'desat'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function kindLabel(kind: DocumentKind | undefined): string {
  if (kind === 'factura') return 'Factura'
  if (kind === 'tiquet') return 'Tiquet'
  return 'Document'
}

function docMeta(doc: (typeof documents.value)[number]): string {
  if (doc.status === 'processing' || doc.status === 'queued') return doc.stage
  if (doc.status === 'error') return 'Error'
  if (doc.invoice?.total.value !== null && doc.invoice?.total.value !== undefined) {
    return `${formatAmount(doc.invoice.total.value)} ${doc.invoice.currency.value ?? 'EUR'}`
  }
  return 'Completat'
}

onMounted(() => {
  void refreshHistory()
  window.addEventListener('paste', onPaste)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark"><AppIcon name="file-text" :size="22" /></span>
        <div class="brand__copy">
          <p class="eyebrow">Factura OCR</p>
          <h1>Dades de factures, sense núvol</h1>
        </div>
      </div>

      <div class="topbar__actions">
        <span class="pill pill--local">
          <AppIcon name="lock" :size="13" />
          100% local
        </span>
        <button class="model-pill" type="button" @click="showSettings = true">
          <AppIcon name="cpu" :size="15" />
          <span class="model-pill__label">{{ modelLabel }}</span>
          <span class="model-pill__state" :class="`model-pill__state--${status}`">
            {{ modelStateLabel }}
          </span>
        </button>
        <button class="icon-btn" type="button" aria-label="Configuració" @click="showSettings = true">
          <AppIcon name="settings" :size="18" />
        </button>
      </div>
    </header>

    <template v-if="!documents.length">
      <main class="landing">
        <div class="card landing__card">
          <DocumentDropzone :max-pages="settings.maxPages" @files="onFiles" />
          <div class="landing__steps">
            <article>
              <span class="step-number">01</span>
              <h3>Puja o fotografia</h3>
              <p>Una imatge o un PDF. També pots enganxar una captura amb Ctrl+V.</p>
            </article>
            <article>
              <span class="step-number">02</span>
              <h3>L’OCR llegeix</h3>
              <p>El model s’executa al navegador i assenyala cada línia amb la seva caixa.</p>
            </article>
            <article>
              <span class="step-number">03</span>
              <h3>Revisa i exporta</h3>
              <p>Comprova els camps, corregeix el que calgui i descarrega JSON o CSV.</p>
            </article>
          </div>
        </div>

        <section class="landing__notes">
          <div class="note card">
            <AppIcon name="lock" :size="18" />
            <div>
              <h3>Privat per disseny</h3>
              <p>Ni factures ni dades surten del dispositiu. El model es descarrega una vegada i es guarda a la memòria cau.</p>
            </div>
          </div>
          <div class="note card">
            <AppIcon name="zap" :size="18" />
            <div>
              <h3>WebGPU o WASM</h3>
              <p>Si el navegador té WebGPU, l’OCR va més de pressa. Si no, cau automàticament a WASM.</p>
            </div>
          </div>
          <div class="note card">
            <AppIcon name="alert" :size="18" />
            <div>
              <h3>Revisa els imports</h3>
              <p>Cap OCR és perfecte. L’app valida NIF i quadra base + IVA amb el total, però la revisió final és teva.</p>
            </div>
          </div>
        </section>

        <HistoryList
          v-if="history.length"
          class="landing__history"
          :entries="history"
          :current-id="null"
          @open="openHistoryEntry"
          @delete="deleteHistoryItem"
        />
      </main>
    </template>

    <div v-else class="workspace">
      <aside class="sidebar">
        <DocumentDropzone compact :max-pages="settings.maxPages" @files="onFiles" />

        <section class="queue card">
          <header class="section-head">
            <div>
              <p class="eyebrow">Cua</p>
              <h2>Documents</h2>
            </div>
            <span class="pill pill--soft">{{ documents.length }}</span>
          </header>

          <ul class="doc-list">
            <li v-for="doc in documents" :key="doc.id">
              <button
                class="doc-item"
                type="button"
                :class="{ 'doc-item--active': doc.id === selectedId }"
                @click="selectDoc(doc.id)"
              >
                <span class="doc-item__icon">
                  <AppIcon :name="doc.sourceKind === 'pdf' ? 'file-text' : 'file'" :size="18" />
                </span>
                <span class="doc-item__body">
                  <span class="doc-item__name">{{ doc.name }}</span>
                  <span class="doc-item__meta">
                    <span class="status-dot" :class="`status-dot--${doc.status}`" />
                    <span>{{ docMeta(doc) }}</span>
                  </span>
                  <span
                    v-if="doc.status === 'processing' && doc.progress !== null"
                    class="mini-progress"
                  >
                    <span :style="{ width: `${doc.progress}%` }" />
                  </span>
                </span>
              </button>
              <button
                class="icon-btn icon-btn--small"
                type="button"
                aria-label="Tancar document"
                title="Tancar document"
                @click="removeDoc(doc.id)"
              >
                <AppIcon name="close" :size="14" />
              </button>
            </li>
          </ul>

          <button
            v-if="exportable.length > 1"
            class="btn btn--ghost btn--wide"
            type="button"
            @click="exportAllCsv"
          >
            <AppIcon name="download" :size="15" />
            Exporta tot (CSV)
          </button>
        </section>

        <HistoryList
          :entries="history"
          :current-id="selected?.historyId ?? null"
          @open="openHistoryEntry"
          @delete="deleteHistoryItem"
        />
      </aside>

      <main class="workbench">
        <template v-if="selected">
          <section class="doc-header card">
            <div class="doc-header__title">
              <p class="eyebrow">
                {{ selected.sourceKind === 'pdf' ? 'PDF' : 'Imatge' }} ·
                {{ formatBytes(selected.size) }}
              </p>
              <h2>{{ selected.name }}</h2>
              <div class="doc-header__badges">
                <span v-if="selected.invoice" class="pill">{{ kindLabel(selected.invoice.kind) }}</span>
                <span v-if="selected.invoice" class="pill pill--soft">
                  Total {{ formatAmount(selected.invoice.total.value) }}
                  {{ selected.invoice.currency.value ?? 'EUR' }}
                </span>
                <span v-if="selected.invoice && !selected.saved" class="pill pill--warn">
                  Canvis sense desar
                </span>
                <span v-if="!selected.sourceFile" class="pill pill--soft">
                  <AppIcon name="history" :size="12" /> Desat
                </span>
              </div>
            </div>

            <div class="doc-header__actions">
              <button
                class="btn btn--ghost"
                type="button"
                :disabled="!selected.sourceFile || isBusy"
                @click="reprocess"
              >
                <AppIcon name="refresh" :size="15" />
                Re-processar
              </button>
              <button
                class="icon-btn"
                type="button"
                title="Girar 90° a l’esquerra i tornar a llegir"
                aria-label="Girar 90 graus a l’esquerra"
                :disabled="!selected.sourceFile || isBusy"
                @click="rotate(-90)"
              >
                <AppIcon name="rotate-left" :size="17" />
              </button>
              <button
                class="icon-btn"
                type="button"
                title="Girar 90° a la dreta i tornar a llegir"
                aria-label="Girar 90 graus a la dreta"
                :disabled="!selected.sourceFile || isBusy"
                @click="rotate(90)"
              >
                <AppIcon name="rotate-right" :size="17" />
              </button>
              <button
                v-if="selected.invoice"
                class="btn btn--ghost"
                type="button"
                @click="save"
              >
                <AppIcon name="check" :size="15" />
                Desar
              </button>
              <button
                v-if="selected.invoice"
                class="btn btn--primary"
                type="button"
                @click="exportJson"
              >
                <AppIcon name="download" :size="15" />
                JSON
              </button>
              <button
                v-if="selected.invoice"
                class="btn btn--ghost"
                type="button"
                @click="exportCsv"
              >
                <AppIcon name="download" :size="15" />
                CSV
              </button>
              <button
                class="icon-btn"
                type="button"
                title="Tancar document"
                aria-label="Tancar document"
                @click="deleteDoc"
              >
                <AppIcon name="close" :size="17" />
              </button>
            </div>
          </section>

          <section
            v-if="selected.status === 'processing' || selected.status === 'queued' || selected.status === 'error'"
            class="status-card card"
          >
            <OcrProgress
              :status="status"
              :progress="progress"
              :message="message"
              :device="device"
            />
            <div class="status-card__row">
              <span class="status-dot" :class="`status-dot--${selected.status}`" />
              <span>{{ selected.status === 'error' ? selected.error : selected.stage }}</span>
              <span v-if="selected.status === 'processing' && selected.progress !== null" class="muted">
                {{ Math.round(selected.progress) }}%
              </span>
            </div>
            <div v-if="selected.error" class="error-box">{{ selected.error }}</div>
          </section>

          <div class="work-grid">
            <section class="preview-panel card">
              <header class="section-head">
                <div>
                  <p class="eyebrow">Original</p>
                  <h2>Vista prèvia</h2>
                </div>
                <div class="preview-tools">
                  <button
                    class="ghost-toggle"
                    :class="{ 'ghost-toggle--active': showBoxes }"
                    type="button"
                    :aria-pressed="showBoxes"
                    @click="showBoxes = !showBoxes"
                  >
                    <AppIcon name="eye" :size="14" />
                    Caixes
                  </button>
                  <div v-if="selected.pages.length > 1" class="page-tabs">
                    <button
                      v-for="(page, index) in selected.pages"
                      :key="page.page"
                      type="button"
                      :class="{ active: index === selected.activePage }"
                      @click="selectPage(selected, index)"
                    >
                      P{{ index + 1 }}
                    </button>
                  </div>
                </div>
              </header>

              <DocumentPreview
                :page="activePage"
                :thumbnail="selected.thumbnail"
                :highlighted="highlightedLines"
                :line-offset="lineOffset"
                :show-boxes="showBoxes"
              />

              <div class="preview-panel__foot">
                <span class="muted">
                  {{
                    activePage
                      ? selected.pages.length > 1
                        ? `Pàgina ${activePage.page + 1} de ${selected.pages.length}`
                        : `Pàgina ${activePage.page + 1}`
                      : 'Document desat'
                  }}
                </span>
                <span v-if="activePage" class="muted">
                  {{ activePage.width }} × {{ activePage.height }} px
                </span>
              </div>
            </section>

            <section v-if="selected.invoice" class="form-panel card">
              <InvoiceForm
                :invoice="selected.invoice"
                @focus-field="onFocusField"
                @blur-field="onBlurField"
                @change="onFormChange"
              />
              <footer class="form-panel__foot">
                <button class="btn btn--ghost" type="button" @click="copyJson">
                  <AppIcon name="copy" :size="15" />
                  Copiar JSON
                </button>
                <button class="btn btn--ghost" type="button" @click="exportCsv">
                  <AppIcon name="download" :size="15" />
                  Exportar CSV
                </button>
                <button class="btn btn--primary" type="button" @click="save">
                  <AppIcon name="check" :size="15" />
                  Desar canvis
                </button>
              </footer>
            </section>

            <section v-else class="form-panel card placeholder-panel">
              <AppIcon name="spark" :size="30" />
              <h3>Encara processant…</h3>
              <p class="muted">
                Quan l’OCR acabi, aquí veuràs els camps per revisar i exportar.
              </p>
            </section>
          </div>
        </template>

        <section v-else class="empty card">
          <AppIcon name="file-text" :size="30" />
          <h2>Selecciona un document</h2>
          <p class="muted">Tria un fitxer de la cua o de l’historial per veure’n les dades.</p>
        </section>
      </main>
    </div>

    <footer class="footer">
      <span>
        OCR local amb
        <a href="https://github.com/midudev/runonweb.ai" target="_blank" rel="noreferrer">runonweb</a>
        · PP-OCRv6 (PaddleOCR, Apache-2.0)
      </span>
      <span class="footer__privacy">
        <AppIcon name="lock" :size="12" />
        Les imatges i els texts no surten del navegador
      </span>
    </footer>

    <Transition name="toast">
      <div v-if="notice" class="toast" :class="`toast--${notice.type}`" role="status">
        <AppIcon :name="notice.type === 'error' ? 'alert' : notice.type === 'success' ? 'check' : 'info'" :size="16" />
        {{ notice.message }}
      </div>
    </Transition>

    <SettingsPanel
      v-if="showSettings"
      :settings="settings"
      :ocr-status="status"
      :device="device"
      @close="showSettings = false"
      @reset="resetSettings"
    />
  </div>
</template>
