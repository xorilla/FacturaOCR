<script setup lang="ts">
import { computed, ref } from 'vue'
import type { HistoryEntry } from '../lib/storage'
import { formatAmount } from '../lib/extract'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  entries: HistoryEntry[]
  currentId?: string | null
}>()

const emit = defineEmits<{
  open: [HistoryEntry]
  delete: [string]
}>()

const query = ref('')

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.entries
  return props.entries.filter((entry) => {
    const invoice = entry.invoice
    return [
      entry.name,
      invoice.issuerName.value,
      invoice.issuerNif.value,
      invoice.invoiceNumber.value,
      invoice.issueDate.value,
      invoice.total.value !== null ? formatAmount(invoice.total.value) : null,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })
})

function formatDate(value: string | null): string {
  if (!value) return 'Sense data'
  const parts = value.split('-')
  if (parts.length !== 3) return value
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function kindLabel(kind: HistoryEntry['invoice']['kind']): string {
  if (kind === 'factura') return 'Factura'
  if (kind === 'tiquet') return 'Tiquet'
  return 'Altres'
}
</script>

<template>
  <section class="history card">
    <header class="section-head">
      <div>
        <p class="eyebrow">Desats</p>
        <h2><AppIcon name="history" :size="16" /> Historial</h2>
      </div>
      <span class="pill pill--soft">{{ entries.length }}</span>
    </header>

    <label class="search">
      <AppIcon name="search" :size="15" />
      <input v-model="query" type="search" placeholder="Cerca per emissor, NIF o número…" aria-label="Cercar a l’historial" />
    </label>

    <div v-if="!filtered.length" class="empty-inline">
      {{ entries.length ? 'Cap resultat per aquesta cerca.' : 'Encara no hi ha documents desats.' }}
    </div>

    <ul v-else class="history__list">
      <li v-for="entry in filtered" :key="entry.id">
        <button
          class="history__item"
          type="button"
          :class="{ 'history__item--active': currentId === entry.id }"
          @click="emit('open', entry)"
        >
          <span class="history__thumb">
            <img v-if="entry.thumbnail" :src="entry.thumbnail" alt="" />
            <AppIcon v-else name="file-text" :size="18" />
          </span>
          <span class="history__body">
            <span class="history__name">{{ entry.invoice.issuerName.value || entry.name }}</span>
            <span class="history__meta">
              {{ kindLabel(entry.invoice.kind) }} · {{ formatDate(entry.invoice.issueDate.value) }}
            </span>
            <span v-if="entry.invoice.total.value !== null" class="history__total">
              {{ formatAmount(entry.invoice.total.value) }} {{ entry.invoice.currency.value ?? 'EUR' }}
            </span>
          </span>
        </button>
        <button
          class="icon-btn icon-btn--danger history__delete"
          type="button"
          title="Esborrar de l’historial"
          aria-label="Esborrar de l’historial"
          @click="emit('delete', entry.id)"
        >
          <AppIcon name="trash" :size="15" />
        </button>
      </li>
    </ul>
  </section>
</template>
