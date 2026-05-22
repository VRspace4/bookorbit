<script setup lang="ts">
import { onMounted } from 'vue'
import TtsProviderConfigPanel from './tts/components/TtsProviderConfigPanel.vue'
import { useTtsProviderConfig } from './tts/composables/useTtsProviderConfig'

defineProps<{ embedded?: boolean }>()

const { config, statuses, saving, fetchConfig, saveConfig } = useTtsProviderConfig()

onMounted(fetchConfig)
</script>

<template>
  <TtsProviderConfigPanel :config="config" :statuses="statuses" :saving="saving" @save="saveConfig" />
</template>
