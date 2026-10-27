<script setup lang="ts">
import type { LineItem } from '../lib/extract'
import { formatAmount } from '../lib/extract'
import ConfidenceDot from './ConfidenceDot.vue'

defineProps<{
  items: LineItem[]
}>()
</script>

<template>
  <div class="line-items">
    <div v-if="!items.length" class="empty-inline">
      No s’han detectat línies de detall. Pots completar les dades principals igualment.
    </div>
    <div v-else class="line-items__scroll">
      <table>
        <thead>
          <tr>
            <th>Descripció</th>
            <th class="num">Quantitat</th>
            <th class="num">Preu unit.</th>
            <th class="num">Import</th>
            <th aria-label="Confiança" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in items" :key="`${index}-${item.description}`">
            <td>{{ item.description }}</td>
            <td class="num">{{ item.quantity ?? '—' }}</td>
            <td class="num">{{ item.unitPrice !== null ? formatAmount(item.unitPrice) : '—' }}</td>
            <td class="num strong">{{ item.amount !== null ? formatAmount(item.amount) : '—' }}</td>
            <td class="dot-cell"><ConfidenceDot :confidence="item.confidence" /></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="muted line-items__note">
      El detall és orientatiu: l’OCR pot barrejar columnes. Els camps de capçalera són la font principal.
    </p>
  </div>
</template>
