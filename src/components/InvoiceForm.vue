<script setup lang="ts">
import { computed } from 'vue'
import type { ExtractedInvoice, FieldValue, SourceRef } from '../lib/extract'
import { formatAmount, parseAmount } from '../lib/extract'
import AppIcon from './AppIcon.vue'
import FormField from './FormField.vue'
import LineItemsTable from './LineItemsTable.vue'
import WarningsPanel from './WarningsPanel.vue'

const props = defineProps<{
  invoice: ExtractedInvoice
}>()

const emit = defineEmits<{
  'focus-field': [SourceRef[]]
  'blur-field': []
  change: []
}>()

const lineCount = computed(() => props.invoice.rawText.split('\n').filter(Boolean).length)

function markEdited(field: FieldValue<unknown>): void {
  field.confidence = 'high'
  field.sources = []
  field.note = undefined
  emit('change')
}

function onFocus(field: FieldValue<unknown>): void {
  emit('focus-field', field.sources)
}

function onBlur(): void {
  emit('blur-field')
}

function setText(field: FieldValue<string>, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  field.value = value.trim() ? value : null
  markEdited(field)
}

function amountText(field: FieldValue<number>): string {
  return field.value === null ? '' : formatAmount(field.value)
}

function setAmount(field: FieldValue<number>, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  const parsed = value.trim() ? parseAmount(value) : null
  field.value = parsed
  field.confidence = value.trim() && parsed === null ? 'low' : 'high'
  field.sources = []
  field.note = undefined
  emit('change')
}

function setKind(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  props.invoice.kind = value === 'factura' || value === 'tiquet' ? value : 'altres'
  emit('change')
}
</script>

<template>
  <div class="invoice-form">
    <section class="form-section">
      <header class="form-section__head">
        <div>
          <p class="eyebrow">Capçalera</p>
          <h3>Document</h3>
        </div>
        <span class="pill pill--soft">
          {{ Math.round(invoice.ocrConfidence * 100) }}% OCR
        </span>
      </header>

      <div class="form-grid">
        <FormField label="Tipus de document">
          <select :value="invoice.kind" @change="setKind">
            <option value="factura">Factura</option>
            <option value="tiquet">Tiquet</option>
            <option value="altres">Altres</option>
          </select>
        </FormField>

        <FormField
          label="Número"
          :confidence="invoice.invoiceNumber.confidence"
          :hint="invoice.invoiceNumber.note"
        >
          <input
            :value="invoice.invoiceNumber.value ?? ''"
            placeholder="2026/0042"
            autocomplete="off"
            @focus="onFocus(invoice.invoiceNumber)"
            @blur="onBlur"
            @input="setText(invoice.invoiceNumber, $event)"
          />
        </FormField>

        <FormField
          label="Data d’emissió"
          :confidence="invoice.issueDate.confidence"
          :hint="invoice.issueDate.note"
        >
          <input
            type="date"
            :value="invoice.issueDate.value ?? ''"
            @focus="onFocus(invoice.issueDate)"
            @blur="onBlur"
            @input="setText(invoice.issueDate, $event)"
          />
        </FormField>

        <FormField
          label="Venciment"
          :confidence="invoice.dueDate.confidence"
          :hint="invoice.dueDate.note"
        >
          <input
            type="date"
            :value="invoice.dueDate.value ?? ''"
            @focus="onFocus(invoice.dueDate)"
            @blur="onBlur"
            @input="setText(invoice.dueDate, $event)"
          />
        </FormField>

        <FormField label="Moneda" :confidence="invoice.currency.confidence" :hint="invoice.currency.note">
          <input
            :value="invoice.currency.value ?? ''"
            placeholder="EUR"
            maxlength="3"
            @focus="onFocus(invoice.currency)"
            @blur="onBlur"
            @input="setText(invoice.currency, $event)"
          />
        </FormField>

        <FormField
          label="Forma de pagament"
          :confidence="invoice.paymentMethod.confidence"
          :hint="invoice.paymentMethod.note"
        >
          <input
            :value="invoice.paymentMethod.value ?? ''"
            placeholder="Targeta, efectiu…"
            @focus="onFocus(invoice.paymentMethod)"
            @blur="onBlur"
            @input="setText(invoice.paymentMethod, $event)"
          />
        </FormField>
      </div>
    </section>

    <section class="form-section">
      <header class="form-section__head">
        <div>
          <p class="eyebrow">Parts</p>
          <h3>Emissor i client</h3>
        </div>
      </header>

      <div class="form-grid">
        <FormField
          label="Emissor"
          :confidence="invoice.issuerName.confidence"
          :hint="invoice.issuerName.note"
          wide
        >
          <input
            :value="invoice.issuerName.value ?? ''"
            placeholder="Nom o raó social"
            @focus="onFocus(invoice.issuerName)"
            @blur="onBlur"
            @input="setText(invoice.issuerName, $event)"
          />
        </FormField>

        <FormField
          label="NIF / CIF emissor"
          :confidence="invoice.issuerNif.confidence"
          :hint="invoice.issuerNif.note"
        >
          <input
            :value="invoice.issuerNif.value ?? ''"
            placeholder="B12345674"
            autocomplete="off"
            @focus="onFocus(invoice.issuerNif)"
            @blur="onBlur"
            @input="setText(invoice.issuerNif, $event)"
          />
        </FormField>

        <FormField
          label="Client"
          :confidence="invoice.customerName.confidence"
          :hint="invoice.customerName.note"
        >
          <input
            :value="invoice.customerName.value ?? ''"
            placeholder="Nom del client"
            @focus="onFocus(invoice.customerName)"
            @blur="onBlur"
            @input="setText(invoice.customerName, $event)"
          />
        </FormField>

        <FormField
          label="NIF / CIF client"
          :confidence="invoice.customerNif.confidence"
          :hint="invoice.customerNif.note"
        >
          <input
            :value="invoice.customerNif.value ?? ''"
            placeholder="12345678Z"
            autocomplete="off"
            @focus="onFocus(invoice.customerNif)"
            @blur="onBlur"
            @input="setText(invoice.customerNif, $event)"
          />
        </FormField>
      </div>
    </section>

    <section class="form-section">
      <header class="form-section__head">
        <div>
          <p class="eyebrow">Imports</p>
          <h3>Base, IVA i total</h3>
        </div>
      </header>

      <div class="form-grid form-grid--amounts">
        <FormField
          label="Base imposable"
          :confidence="invoice.base.confidence"
          :hint="invoice.base.note"
        >
          <div class="amount-input">
            <input
              inputmode="decimal"
              :value="amountText(invoice.base)"
              placeholder="0,00"
              @focus="onFocus(invoice.base)"
              @blur="onBlur"
              @input="setAmount(invoice.base, $event)"
            />
            <span>{{ invoice.currency.value ?? 'EUR' }}</span>
          </div>
        </FormField>

        <FormField
          label="Quota d’IVA"
          :confidence="invoice.vatAmount.confidence"
          :hint="invoice.vatAmount.note"
        >
          <div class="amount-input">
            <input
              inputmode="decimal"
              :value="amountText(invoice.vatAmount)"
              placeholder="0,00"
              @focus="onFocus(invoice.vatAmount)"
              @blur="onBlur"
              @input="setAmount(invoice.vatAmount, $event)"
            />
            <span>{{ invoice.currency.value ?? 'EUR' }}</span>
          </div>
        </FormField>

        <FormField
          label="Total"
          :confidence="invoice.total.confidence"
          :hint="invoice.total.note"
        >
          <div class="amount-input amount-input--total">
            <input
              inputmode="decimal"
              :value="amountText(invoice.total)"
              placeholder="0,00"
              @focus="onFocus(invoice.total)"
              @blur="onBlur"
              @input="setAmount(invoice.total, $event)"
            />
            <span>{{ invoice.currency.value ?? 'EUR' }}</span>
          </div>
        </FormField>
      </div>

      <div v-if="invoice.vat.length" class="vat-table">
        <div class="vat-row vat-row--head">
          <span>Tipus</span>
          <span class="num">Base</span>
          <span class="num">Quota</span>
        </div>
        <div v-for="(entry, index) in invoice.vat" :key="index" class="vat-row">
          <span>{{ entry.rate !== null ? `${entry.rate} %` : '—' }}</span>
          <span class="num">{{ entry.base !== null ? formatAmount(entry.base) : '—' }}</span>
          <span class="num">{{ entry.amount !== null ? formatAmount(entry.amount) : '—' }}</span>
        </div>
      </div>
    </section>

    <section class="form-section">
      <header class="form-section__head">
        <div>
          <p class="eyebrow">Detall</p>
          <h3>Línies detectades</h3>
        </div>
        <span class="pill pill--soft">{{ invoice.lineItems.length }}</span>
      </header>
      <LineItemsTable :items="invoice.lineItems" />
    </section>

    <WarningsPanel :warnings="invoice.warnings" />

    <details class="raw-text">
      <summary>
        <span class="raw-text__title">
          <AppIcon name="file-text" :size="16" />
          Text OCR complet
        </span>
        <span class="muted">{{ lineCount }} línies</span>
      </summary>
      <pre>{{ invoice.rawText }}</pre>
    </details>
  </div>
</template>
