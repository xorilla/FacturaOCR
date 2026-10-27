<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{
  warnings: string[]
}>()
</script>

<template>
  <section class="warnings" :class="{ 'warnings--clean': warnings.length === 0 }">
    <header class="warnings__head">
      <AppIcon :name="warnings.length ? 'alert' : 'check'" :size="16" />
      <h3>{{ warnings.length ? 'Revisa aquests punts' : 'Sense incoherències detectades' }}</h3>
      <span v-if="warnings.length" class="pill pill--tiny">{{ warnings.length }}</span>
    </header>
    <ul v-if="warnings.length" class="warnings__list">
      <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
    </ul>
    <p v-else class="muted warnings__ok">
      Les dades quadren i els camps obligatoris s’han detectat. Tot i així, valida sempre els imports.
    </p>
  </section>
</template>
